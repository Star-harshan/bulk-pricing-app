import "@shopify/ui-extensions/preact";
import {render} from "preact";
import {useState} from "preact/hooks";

export default async () => {
  render(<App />, document.body);
};

function App() {
  const shopify = window.shopify;

  const existingMetafield = shopify?.data?.metafields?.find(
    (metafield) =>
      metafield.namespace === "$app" &&
      metafield.key === "function-configuration",
  );

  let initialConfig = {
    rules: [],
  };

  if (existingMetafield?.value) {
    try {
      initialConfig = JSON.parse(existingMetafield.value);
    } catch {
      initialConfig = {
        rules: [],
      };
    }
  }

  const [rules, setRules] = useState(initialConfig.rules || []);
  const [error, setError] = useState(null);

  async function addProduct() {
    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: false,
    });

    if (!selected || selected.length === 0) {
      return;
    }

    const product = selected[0];

    setRules([
      ...rules,
      {
        productId: product.id,
        productTitle: product.title,
        tiers: [
          {
            min: 1,
            max: 5,
            price: "",
          },
          {
            min: 6,
            max: 10,
            price: "",
          },
          {
            min: 11,
            max: null,
            price: "",
          },
        ],
      },
    ]);
  }

  async function changeProduct(index) {
    const existing = rules[index];

    const selected = await shopify.resourcePicker({
      type: "product",
      multiple: false,
      selectionIds: existing.productId ? [existing.productId] : undefined,
    });

    if (!selected || selected.length === 0) {
      return;
    }

    const product = selected[0];
    const updated = [...rules];

    updated[index] = {
      ...updated[index],
      productId: product.id,
      productTitle: product.title,
    };

    setRules(updated);
  }

  function updateTier(ruleIndex, tierIndex, field, value) {
    const updated = [...rules];

    updated[ruleIndex].tiers[tierIndex] = {
      ...updated[ruleIndex].tiers[tierIndex],
      [field]:
        field === "min" || field === "max"
          ? value === ""
            ? null
            : Number(value)
          : value,
    };

    setRules(updated);
  }

  function removeProduct(index) {
    setRules(rules.filter((_, i) => i !== index));
  }

  async function save() {
    setError(null);

    const configuration = {
      rules,
    };

    const result = await shopify.applyMetafieldChange({
      type: "updateMetafield",

      namespace: "$app",

      key: "function-configuration",

      value: JSON.stringify(configuration),

      valueType: "json",
    });

    if (result.type === "error") {
      setError(result.message);
    }
  }

  return (
    <s-function-settings>
      <s-stack direction="block" gap="base">

        <s-heading>
          Bulk pricing
        </s-heading>

        <s-text>
          Configure quantity-based pricing for your products.
        </s-text>

        {error && (
          <s-banner tone="critical">
            {error}
          </s-banner>
        )}

        {rules.map((rule, ruleIndex) => (
          <s-section
            key={ruleIndex}
            padding="base"
          >

            <s-stack direction="block" gap="base">

              <s-stack direction="inline" gap="base" alignItems="center">
                <s-text>
                  {rule.productTitle || rule.productId || "No product selected"}
                </s-text>

                <s-button onClick={() => changeProduct(ruleIndex)}>
                  {rule.productId ? "Change product" : "Select product"}
                </s-button>
              </s-stack>

              <s-heading>
                Quantity tiers
              </s-heading>

              {rule.tiers.map((tier, tierIndex) => (
                <s-stack
                  direction="inline"
                  gap="base"
                  key={tierIndex}
                >

                  <s-number-field
                    label="Minimum quantity"
                    value={String(tier.min ?? "")}
                    onInput={(event) =>
                      updateTier(
                        ruleIndex,
                        tierIndex,
                        "min",
                        event.currentTarget.value,
                      )
                    }
                  />

                  <s-number-field
                    label="Maximum quantity"
                    value={
                      tier.max === null
                        ? ""
                        : String(tier.max)
                    }
                    placeholder="Unlimited"
                    onInput={(event) =>
                      updateTier(
                        ruleIndex,
                        tierIndex,
                        "max",
                        event.currentTarget.value,
                      )
                    }
                  />

                  <s-number-field
                    label="Unit price"
                    value={tier.price}
                    onInput={(event) =>
                      updateTier(
                        ruleIndex,
                        tierIndex,
                        "price",
                        event.currentTarget.value,
                      )
                    }
                  />

                </s-stack>
              ))}

              <s-button
                tone="critical"
                onClick={() => removeProduct(ruleIndex)}
              >
                Remove product
              </s-button>

            </s-stack>

          </s-section>
        ))}

        <s-button onClick={addProduct}>
          Add product
        </s-button>

        <s-button
          variant="primary"
          onClick={save}
        >
          Save pricing rules
        </s-button>

      </s-stack>
    </s-function-settings>
  );
}
