import { authenticate } from "../shopify.server";
import {
  FUNCTION_HANDLE,
  METAFIELD_NAMESPACE,
  METAFIELD_KEY,
  ALLOWED_PRODUCT_TAGS,
  findExistingDiscount,
  parseConfiguration,
} from "../bulk-pricing.server";

const RULE_EXAMPLE =
  '{ "rules": [{ "min_quantity": 3, "discount_type": "percentage", "discount_value": 20, "product_tag": "bulk-pricing" }] }';

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

/*
 * Accepts direct JSON input (see RULE_EXAMPLE) and converts it into
 * per-tag ascending quantity tiers, with each tier's `max` computed from the
 * next tier's `min_quantity` within the same tag. Each rule's `product_tag`
 * must be one of ALLOWED_PRODUCT_TAGS, since the function's input query can
 * only check tags it was deployed knowing about.
 *
 * Throws with a user-facing message when the input is malformed.
 */
function parsePercentageTiers(prompt) {
  let parsed;

  try {
    parsed = JSON.parse(prompt);
  } catch {
    throw new Error(`Invalid JSON. Expected: ${RULE_EXAMPLE}`);
  }

  if (!parsed || !Array.isArray(parsed.rules) || parsed.rules.length === 0) {
    throw new Error(`Invalid rule JSON. Expected: ${RULE_EXAMPLE}`);
  }

  const byTag = new Map();

  for (const rule of parsed.rules) {
    const minQuantity = Number(rule.min_quantity);
    const percentage = Number(rule.discount_value);
    const tag = rule.product_tag;

    if (rule.discount_type !== "percentage") {
      throw new Error(
        `Unsupported discount_type "${rule.discount_type}". Only "percentage" is supported.`,
      );
    }

    if (!Number.isFinite(minQuantity) || minQuantity <= 0) {
      throw new Error(`Invalid min_quantity: ${rule.min_quantity}`);
    }

    if (!Number.isFinite(percentage) || percentage <= 0 || percentage > 100) {
      throw new Error(
        `Invalid discount_value: ${rule.discount_value}. Must be greater than 0 and at most 100.`,
      );
    }

    if (!ALLOWED_PRODUCT_TAGS.includes(tag)) {
      throw new Error(
        `Unknown product_tag "${tag}". Allowed tags: ${ALLOWED_PRODUCT_TAGS.join(", ")}.`,
      );
    }

    if (!byTag.has(tag)) {
      byTag.set(tag, new Map());
    }

    byTag.get(tag).set(minQuantity, percentage);
  }

  const tiers = [];

  for (const [tag, byMinQuantity] of byTag) {
    const sorted = [...byMinQuantity.entries()].sort((a, b) => a[0] - b[0]);

    sorted.forEach(([min, percentage], index) => {
      tiers.push({
        min,
        max: index < sorted.length - 1 ? sorted[index + 1][0] - 1 : null,
        percentage,
        tag,
      });
    });
  }

  return tiers;
}

export async function action({ request }) {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const { admin } = await authenticate.admin(request);

  try {
    const body = await request.json();
    const existing = await findExistingDiscount(admin);
    const existingConfig = parseConfiguration(existing?.metafield?.value) || {
      rules: [],
      percentageTiers: [],
    };

    let percentageTiers;

    if (body.action === "delete") {
      const { tag, min } = body;

      percentageTiers = (existingConfig.percentageTiers || []).filter(
        (tier) => !(tier.tag === tag && tier.min === min),
      );
    } else {
      const { prompt } = body;

      if (!prompt || typeof prompt !== "string") {
        return jsonResponse({ error: "Please provide a promotion rule." }, 400);
      }

      try {
        percentageTiers = parsePercentageTiers(prompt);
      } catch (validationError) {
        return jsonResponse({ error: validationError.message }, 400);
      }
    }

    const configuration = {
      rules: existingConfig.rules || [],
      percentageTiers,
    };

    const metafields = [
      {
        namespace: METAFIELD_NAMESPACE,
        key: METAFIELD_KEY,
        type: "json",
        value: JSON.stringify(configuration),
      },
    ];

    let userErrors;

    if (existing) {
      const response = await admin.graphql(
        `#graphql
        mutation UpdateBulkPricingDiscount(
          $id: ID!
          $automaticAppDiscount: DiscountAutomaticAppInput!
        ) {
          discountAutomaticAppUpdate(id: $id, automaticAppDiscount: $automaticAppDiscount) {
            automaticAppDiscount {
              discountId
            }
            userErrors {
              field
              message
            }
          }
        }
        `,
        {
          variables: {
            id: existing.id,
            automaticAppDiscount: { metafields },
          },
        },
      );

      const { data } = await response.json();
      userErrors = data?.discountAutomaticAppUpdate?.userErrors;
    } else {
      const response = await admin.graphql(
        `#graphql
        mutation CreateBulkPricingDiscount(
          $automaticAppDiscount: DiscountAutomaticAppInput!
        ) {
          discountAutomaticAppCreate(automaticAppDiscount: $automaticAppDiscount) {
            automaticAppDiscount {
              discountId
            }
            userErrors {
              field
              message
            }
          }
        }
        `,
        {
          variables: {
            automaticAppDiscount: {
              title: "Bulk pricing",
              functionHandle: FUNCTION_HANDLE,
              discountClasses: ["PRODUCT"],
              startsAt: new Date().toISOString(),
              metafields,
            },
          },
        },
      );

      const { data } = await response.json();
      userErrors = data?.discountAutomaticAppCreate?.userErrors;
    }

    if (userErrors && userErrors.length > 0) {
      return jsonResponse(
        { error: userErrors.map((e) => e.message).join(" ") },
        400,
      );
    }

    return jsonResponse(
      { success: true, tiers: percentageTiers, configuration },
      200,
    );
  } catch (error) {
    console.error("Quantity rule error:", error);
    return jsonResponse({ error: "Failed to process promotion rule." }, 500);
  }
}
