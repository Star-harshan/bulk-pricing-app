import { useState } from "react";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import { findExistingDiscount, parseConfiguration } from "../bulk-pricing.server";

export async function loader({ request }) {
  const { admin } = await authenticate.admin(request);
  const existing = await findExistingDiscount(admin);

  return {
    configuration: parseConfiguration(existing?.metafield?.value),
  };
}

function tiersToRuleJson(tiers) {
  return JSON.stringify(
    {
      rules: tiers.map((tier) => ({
        min_quantity: tier.min,
        discount_type: "percentage",
        discount_value: tier.percentage,
        product_tag: tier.tag,
      })),
    },
    null,
    2,
  );
}

const PLACEHOLDER = `{
  "rules": [
    { "min_quantity": 3, "discount_type": "percentage", "discount_value": 20, "product_tag": "bulk-pricing" },
    { "min_quantity": 5, "discount_type": "percentage", "discount_value": 30, "product_tag": "bulk-pricing" }
  ]
}`;

export default function QuantityRules() {
  const { configuration: initialConfiguration } = useLoaderData();
  const [prompt, setPrompt] = useState("");
  const [configuration, setConfiguration] = useState(initialConfiguration);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [deletingKey, setDeletingKey] = useState(null);

  async function post(body) {
    const response = await fetch("/api/quantity-rules", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Something went wrong.");
    }

    return data;
  }

  async function saveRule() {
    setLoading(true);
    setError("");

    try {
      const data = await post({ prompt });
      setConfiguration(data.configuration);
      setPrompt("");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function deleteTier(tier) {
    const key = `${tier.tag}:${tier.min}`;
    setDeletingKey(key);
    setError("");

    try {
      const data = await post({ action: "delete", tag: tier.tag, min: tier.min });
      setConfiguration(data.configuration);
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingKey(null);
    }
  }

  function editTiers() {
    setPrompt(tiersToRuleJson(configuration?.percentageTiers || []));
  }

  const tiers = configuration?.percentageTiers || [];

  return (
    <s-page heading="Bulk pricing rules">
      <s-section heading="Promotion rule">
        <s-paragraph>
          Paste your promotion rules as JSON. Saving replaces the full set of
          quantity tiers shown on the right with this JSON. This creates or
          updates a shop-wide &quot;Bulk pricing&quot; automatic discount that
          applies per product line based on quantity, only for products
          carrying &quot;product_tag&quot; (one of: bulk-pricing, clearance,
          sale).
        </s-paragraph>

        <s-text-area
          label="Promotion rules (JSON)"
          value={prompt}
          placeholder={PLACEHOLDER}
          rows={20}
          onInput={(event) => setPrompt(event.currentTarget.value)}
        />

        {error && <s-banner tone="critical">{error}</s-banner>}

        <s-button
          variant="primary"
          onClick={saveRule}
          disabled={!prompt.trim()}
          {...(loading ? { loading: true } : {})}
        >
          Save rule
        </s-button>
      </s-section>

      <s-section slot="aside" heading="Saved rule">
        {tiers.length > 0 && (
          <div style={{ marginBottom: "12px" }}>
            <s-button onClick={editTiers} variant="secondary">
              Edit
            </s-button>
          </div>
        )}

        {tiers.length === 0 ? (
          <s-paragraph>No rule saved yet.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {tiers.map((tier) => {
              const key = `${tier.tag}:${tier.min}`;

              return (
                <s-box
                  key={key}
                  padding="base"
                  borderWidth="base"
                  borderRadius="base"
                  background="subdued"
                >
                  <s-stack
                    direction="inline"
                    gap="base"
                    alignItems="center"
                    justifyContent="space-between"
                  >
                    <s-stack direction="inline" gap="tight" alignItems="center">
                      <s-badge>{tier.tag}</s-badge>
                      <s-text>
                        {tier.max ? `${tier.min}–${tier.max}` : `${tier.min}+`}{" "}
                        units → {tier.percentage}% off
                      </s-text>
                    </s-stack>

                    <s-button
                      variant="tertiary"
                      tone="critical"
                      onClick={() => deleteTier(tier)}
                      disabled={deletingKey === key}
                      {...(deletingKey === key ? { loading: true } : {})}
                    >
                      Delete
                    </s-button>
                  </s-stack>
                </s-box>
              );
            })}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
