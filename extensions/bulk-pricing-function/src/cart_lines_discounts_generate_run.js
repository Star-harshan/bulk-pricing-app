// @ts-check
import {
  DiscountClass,
  ProductDiscountSelectionStrategy,
} from "../generated/api";

/**
 * @typedef {import("../generated/api").CartLinesRunInput} CartInput
 * @typedef {import("../generated/api").CartLinesDiscountsGenerateRunResult} CartLinesDiscountsGenerateRunResult
 * @typedef {import("../generated/api").ProductDiscountCandidate} ProductDiscountCandidate
 */

/**
 * @typedef {object} Tier
 * @property {number} min
 * @property {number} [max]
 * @property {string} price
 */

/**
 * @typedef {object} ProductRule
 * @property {string} productId
 * @property {Tier[]} tiers
 */

/**
 * Shop-wide quantity tiers (no productId): apply to any cart line whose
 * product has `tag` and doesn't already match a ProductRule above. `tag`
 * must be one of the literal tags queried in the .graphql input file, since
 * that query is static and can't accept a runtime tag list.
 * @typedef {object} PercentageTier
 * @property {number} min
 * @property {number} [max]
 * @property {number} percentage
 * @property {string} tag
 */

/**
 * @typedef {object} Configuration
 * @property {ProductRule[]} rules
 * @property {PercentageTier[]} percentageTiers
 */

/**
 * @param {CartInput} input
 * @returns {CartLinesDiscountsGenerateRunResult}
 */
export function cartLinesDiscountsGenerateRun(input) {
  const hasProductDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Product,
  );

  if (!hasProductDiscountClass) {
    return { operations: [] };
  }

  const configuration = parseConfiguration(input.discount.metafield);

  if (!configuration) {
    return { operations: [] };
  }

  const { rules, percentageTiers } = configuration;

  /** @type {ProductDiscountCandidate[]} */
  const candidates = [];

  for (const line of input.cart.lines) {
    if (line.merchandise.__typename !== "ProductVariant") {
      continue;
    }

    const product = line.merchandise.product;
    const productId = product.id;
    const productTags = new Set(
      product.hasTags
        .filter((/** @type {{hasTag: boolean}} */ response) => response.hasTag)
        .map((/** @type {{tag: string}} */ response) => response.tag),
    );

    const quantity = line.quantity;
    const currentPrice = Number(line.cost.amountPerQuantity.amount);

    const rule = rules.find((rule) => rule.productId === productId);
    const productTier = rule?.tiers.find(
      (tier) =>
        quantity >= tier.min && (tier.max == null || quantity <= tier.max),
    );

    // A per-product fixed-price tier takes priority over shop-wide percentage tiers,
    // so the same line is never discounted twice.
    if (productTier) {
      const targetPrice = Number(productTier.price);

      // Do not create a discount when the tier price isn't actually cheaper.
      if (Number.isNaN(targetPrice) || targetPrice >= currentPrice) {
        continue;
      }

      const discountAmount = currentPrice - targetPrice;

      candidates.push({
        targets: [{ cartLine: { id: line.id } }],
        message: `Bulk pricing: ${quantity} units`,
        value: {
          fixedAmount: {
            amount: String(discountAmount),
            appliesToEachItem: true,
          },
        },
      });

      continue;
    }

    const percentageTier = percentageTiers.find(
      (tier) =>
        quantity >= tier.min &&
        (tier.max == null || quantity <= tier.max) &&
        productTags.has(tier.tag),
    );

    if (percentageTier && percentageTier.percentage > 0) {
      candidates.push({
        targets: [{ cartLine: { id: line.id } }],
        message: `Bulk pricing: ${percentageTier.percentage}% off for ${quantity} units (${percentageTier.tag})`,
        value: {
          percentage: {
            value: String(percentageTier.percentage),
          },
        },
      });
    }
  }

  if (candidates.length === 0) {
    return { operations: [] };
  }

  return {
    operations: [
      {
        productDiscountsAdd: {
          selectionStrategy: ProductDiscountSelectionStrategy.All,
          candidates,
        },
      },
    ],
  };
}

/**
 * @param {{value: string} | null | undefined} metafield
 * @returns {Configuration | null}
 */
function parseConfiguration(metafield) {
  if (!metafield) {
    return null;
  }

  try {
    const value = JSON.parse(metafield.value);
    return {
      rules: value.rules ?? [],
      percentageTiers: value.percentageTiers ?? [],
    };
  } catch {
    return null;
  }
}
