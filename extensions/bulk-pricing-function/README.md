# Shopify Function development with JavaScript

## Dependencies

- A supported LTS version of [Node.js](https://nodejs.org/)
- `@shopify/shopify_function` (declared in `package.json`), which the CLI wires up automatically

## Building the function

The Shopify CLI compiles `src/index.js` to Wasm using Javy. Build it with:

```shell
shopify app function build
```

The Shopify CLI `build`/`dev` commands also run this automatically, based on the configuration in `shopify.extension.toml`. Before building, regenerate the GraphQL input types with:

```shell
shopify app function typegen
```

This writes `generated/api.js`, which `src/index.js`'s targets import for input/output types and the runtime enum values (`DiscountClass`, `ProductDiscountSelectionStrategy`, etc.).
