import { useEffect, useState } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useFetcher, useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  Button,
  BlockStack,
  Box,
  List,
  Link,
  InlineStack,
  TextField,
  Banner,
  Icon,
  Badge,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { CheckIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  
  // Get the current session data
  const currentSession = await prisma.session.findUnique({
    where: {
      id: session.id
    }
  });

  // Use type assertion to access the apiKey field
  const sessionData = currentSession as any;
  const apiKey = sessionData?.apiKey || "";

  return json({
    apiKey,
    isConnected: Boolean(apiKey)
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();

  if (formData.get("action") === "save_api_key") {
    const apiKey = formData.get("apiKey")?.toString() || "";

    // Use a raw SQL update since TypeScript doesn't recognize the apiKey field
    await prisma.$executeRaw`UPDATE "Session" SET "apiKey" = ${apiKey} WHERE "id" = ${session.id}`;

    return json({
      type: "api_key_update",
      status: "success",
      apiKey,
      isConnected: Boolean(apiKey),
    });
  }

  // Handle product creation (existing code)
  const color = ["Red", "Orange", "Yellow", "Green"][
    Math.floor(Math.random() * 4)
  ];
  const response = await admin.graphql(
    `#graphql
      mutation populateProduct($product: ProductCreateInput!) {
        productCreate(product: $product) {
          product {
            id
            title
            handle
            status
            variants(first: 10) {
              edges {
                node {
                  id
                  price
                  barcode
                  createdAt
                }
              }
            }
          }
        }
      }`,
    {
      variables: {
        product: {
          title: `${color} Snowboard`,
        },
      },
    },
  );
  const responseJson = await response.json();

  const product = responseJson.data!.productCreate!.product!;
  const variantId = product.variants.edges[0]!.node!.id!;

  const variantResponse = await admin.graphql(
    `#graphql
    mutation shopifyRemixTemplateUpdateVariant($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants {
          id
          price
          barcode
          createdAt
        }
      }
    }`,
    {
      variables: {
        productId: product.id,
        variants: [{ id: variantId, price: "100.00" }],
      },
    },
  );

  const variantResponseJson = await variantResponse.json();

  return {
    type: "product_creation",
    product: responseJson.data.productCreate.product,
    variant: variantResponseJson.data.productVariantsBulkUpdate.productVariants,
  };
};

export default function Index() {
  const fetcher = useFetcher<typeof action>();
  const loaderData = useLoaderData<typeof loader>();
  const [apiKey, setApiKey] = useState(loaderData.apiKey);
  const [apiKeySaved, setApiKeySaved] = useState(false);

  const shopify = useAppBridge();
  const isLoading =
    ["loading", "submitting"].includes(fetcher.state) &&
    fetcher.formMethod === "POST";
  
  // Use type assertion to help TypeScript understand our data structure
  const productData = fetcher.data?.type === "product_creation" ? (fetcher.data as any) : null;
  const productId = productData?.product?.id?.replace(
    "gid://shopify/Product/",
    "",
  );

  useEffect(() => {
    if (productId) {
      shopify.toast.show("Product created");
    }
  }, [productId, shopify]);

  // For product generation
  const generateProduct = () => fetcher.submit({}, { method: "POST" });

  // For API key saving
  const handleApiKeySave = () => {
    fetcher.submit(
      { action: "save_api_key", apiKey },
      { method: "POST" }
    );
    setApiKeySaved(true);
    setTimeout(() => setApiKeySaved(false), 3000);
  };

  return (
    <Page>
      <TitleBar title="Remix app template" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            {loaderData.isConnected ? (
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      API Configuration
                    </Text>
                    <InlineStack gap="200" align="center">
                      <Icon source={CheckIcon} tone="success" />
                      <Text as="span" variant="bodyMd" fontWeight="bold">LIVE</Text>
                    </InlineStack>
                  </InlineStack>
                  
                  <Banner title="Connected" tone="success">
                    You are successfully connected to the API service.
                  </Banner>
                  
                  <InlineStack align="space-between">
                    <Text as="span" variant="bodyMd">API Key:</Text>
                    <Text as="span" variant="bodyMd">
                      {loaderData.apiKey.substring(0, 4)}•••••••{loaderData.apiKey.substring(loaderData.apiKey.length - 4)}
                    </Text>
                  </InlineStack>
                  
                  <Button 
                    onClick={() => {
                      setApiKey("");
                      fetcher.submit(
                        { action: "save_api_key", apiKey: "" },
                        { method: "POST" }
                      );
                    }}
                  >
                    Disconnect
                  </Button>
                </BlockStack>
              </Card>
            ) : (
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingMd">
                    API Configuration
                  </Text>
                  {apiKeySaved && (
                    <Banner title="Success" tone="success">
                      API key has been saved successfully.
                    </Banner>
                  )}
                  <Banner
                    title="API Key Missing"
                    tone="critical"
                  >
                    Please provide an API key to connect to the service.
                  </Banner>
                  <TextField
                    label="API Key"
                    value={apiKey}
                    onChange={setApiKey}
                    autoComplete="off"
                    helpText="Enter your API key for integration"
                  />
                  <Button variant="primary" onClick={handleApiKeySave}>
                    Save API Key
                  </Button>
                </BlockStack>
              </Card>
            )}
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
