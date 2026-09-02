export const FUNCTION_HANDLE = "bulk-pricing-function";
export const METAFIELD_NAMESPACE = "$app";
export const METAFIELD_KEY = "function-configuration";

// Keep in sync with the hasTags(tags: [...]) list in
// extensions/bulk-pricing-function/src/cart_lines_discounts_generate_run.graphql.
// The function's input query is static, so a tag must be added there (and the
// function redeployed) before it can be referenced here.
export const ALLOWED_PRODUCT_TAGS = ["bulk-pricing", "clearance", "sale"];

export async function findExistingDiscount(admin) {
  const response = await admin.graphql(
    `#graphql
    query FindBulkPricingDiscount {
      discountNodes(first: 25, query: "method:automatic") {
        nodes {
          id
          metafield(namespace: "${METAFIELD_NAMESPACE}", key: "${METAFIELD_KEY}") {
            value
          }
          discount {
            ... on DiscountAutomaticApp {
              appDiscountType {
                appKey
              }
            }
          }
        }
      }
    }
    `,
  );

  const { data } = await response.json();
  const nodes = data?.discountNodes?.nodes || [];

  // eslint-disable-next-line no-undef
  const apiKey = process.env.SHOPIFY_API_KEY;

  return nodes.find((node) => node.discount?.appDiscountType?.appKey === apiKey);
}

export function parseConfiguration(metafieldValue) {
  if (!metafieldValue) {
    return null;
  }

  try {
    return JSON.parse(metafieldValue);
  } catch {
    return null;
  }
}
