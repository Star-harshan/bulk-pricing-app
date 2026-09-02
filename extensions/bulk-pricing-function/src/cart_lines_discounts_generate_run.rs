use super::schema;
use shopify_function::prelude::*;
use shopify_function::Result;

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct Configuration {
    #[serde(default)]
    rules: Vec<ProductRule>,
    #[serde(default)]
    percentage_tiers: Vec<PercentageTier>,
}

#[derive(serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct ProductRule {
    product_id: String,
    tiers: Vec<Tier>,
}

#[derive(serde::Deserialize, Debug)]
struct Tier {
    min: i32,
    max: Option<i32>,
    price: String,
}

// Shop-wide quantity tiers (no product_id): apply to any cart line whose
// product has `tag` and doesn't already match a `ProductRule` above. `tag`
// must be one of the literal tags queried in the .graphql input file, since
// that query is static and can't accept a runtime tag list.
#[derive(serde::Deserialize, Debug)]
struct PercentageTier {
    min: i32,
    max: Option<i32>,
    percentage: f64,
    tag: String,
}

#[shopify_function]
fn cart_lines_discounts_generate_run(
    input: schema::cart_lines_discounts_generate_run::Input,
) -> Result<schema::CartLinesDiscountsGenerateRunResult> {
    let has_product_discount_class = input
        .discount()
        .discount_classes()
        .contains(&schema::DiscountClass::Product);

    if !has_product_discount_class {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    }

    let configuration = match input
        .discount()
        .metafield()
        .and_then(|metafield| serde_json::from_str::<Configuration>(metafield.value()).ok())
    {
        Some(config) => config,
        None => return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] }),
    };

    let mut candidates = vec![];

    for line in input.cart().lines().iter() {
        let (product_id, product_tags) = match line.merchandise() {
            schema::cart_lines_discounts_generate_run::input::cart::lines::Merchandise::ProductVariant(
                variant,
            ) => {
                let product = variant.product();
                let tags: std::collections::HashSet<String> = product
                    .has_tags()
                    .iter()
                    .filter(|response| *response.has_tag())
                    .map(|response| response.tag().clone())
                    .collect();

                (product.id().clone(), tags)
            }

            _ => continue,
        };

        let quantity = *line.quantity();
        let current_price = line.cost().amount_per_quantity().amount().as_f64();

        let product_tier = configuration
            .rules
            .iter()
            .find(|rule| rule.product_id == product_id)
            .and_then(|rule| {
                rule.tiers
                    .iter()
                    .find(|tier| quantity >= tier.min && tier.max.map_or(true, |max| quantity <= max))
            });

        // A per-product fixed-price tier takes priority over shop-wide percentage tiers,
        // so the same line is never discounted twice.
        if let Some(tier) = product_tier {
            let target_price: f64 = match tier.price.parse() {
                Ok(value) => value,
                Err(_) => continue,
            };

            // Do not create a discount when the tier price isn't actually cheaper.
            if target_price >= current_price {
                continue;
            }

            let discount_amount = current_price - target_price;

            candidates.push(schema::ProductDiscountCandidate {
                targets: vec![schema::ProductDiscountCandidateTarget::CartLine(
                    schema::CartLineTarget {
                        id: line.id().clone(),
                        quantity: None,
                    },
                )],
                message: Some(format!("Bulk pricing: {} units", quantity)),
                value: schema::ProductDiscountCandidateValue::FixedAmount(
                    schema::ProductDiscountCandidateFixedAmount {
                        amount: Decimal(discount_amount),
                        applies_to_each_item: Some(true),
                    },
                ),
                associated_discount_code: None,
                prerequisites: None,
            });

            continue;
        }

        let percentage_tier = configuration.percentage_tiers.iter().find(|tier| {
            quantity >= tier.min
                && tier.max.map_or(true, |max| quantity <= max)
                && product_tags.contains(&tier.tag)
        });

        if let Some(tier) = percentage_tier {
            if tier.percentage <= 0.0 {
                continue;
            }

            candidates.push(schema::ProductDiscountCandidate {
                targets: vec![schema::ProductDiscountCandidateTarget::CartLine(
                    schema::CartLineTarget {
                        id: line.id().clone(),
                        quantity: None,
                    },
                )],
                message: Some(format!(
                    "Bulk pricing: {}% off for {} units ({})",
                    tier.percentage, quantity, tier.tag
                )),
                value: schema::ProductDiscountCandidateValue::Percentage(schema::Percentage {
                    value: Decimal(tier.percentage),
                }),
                associated_discount_code: None,
                prerequisites: None,
            });
        }
    }

    if candidates.is_empty() {
        return Ok(schema::CartLinesDiscountsGenerateRunResult { operations: vec![] });
    }

    Ok(schema::CartLinesDiscountsGenerateRunResult {
        operations: vec![schema::CartOperation::ProductDiscountsAdd(
            schema::ProductDiscountsAddOperation {
                selection_strategy: schema::ProductDiscountSelectionStrategy::All,
                candidates,
            },
        )],
    })
}
