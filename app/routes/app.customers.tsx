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
  Banner,
  ProgressBar,
  Icon,
  InlineStack,
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
      id: session.id,
    },
  });

  // Use type assertion to access the apiKey field
  const sessionData = currentSession;
  const apiKey = sessionData?.apiKey || "";

  return json({
    apiKey,
    isConnected: Boolean(apiKey),
    shop: session.shop,
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  console.log("Starting customer sync process...");

  // Get API key from session
  const currentSession = await prisma.session.findUnique({
    where: {
      id: session.id,
    },
  });

  // Use type assertion to access the apiKey field
  const sessionData = currentSession as any;
  const apiKey = sessionData?.apiKey || "";

  if (!apiKey) {
    console.log("Sync failed: No API key configured");
    return json({
      success: false,
      message:
        "API key is not configured. Please set up your API key in the app settings.",
      customers: [],
    });
  }

  try {
    let hasNextPage = true;
    let cursor = null;
    let allCustomers: any[] = [];
    let batchNumber = 0;
    const BATCH_SIZE = 50;

    console.log(`Starting batch processing with size: ${BATCH_SIZE}`);

    while (hasNextPage) {
      batchNumber++;
      console.log(`Processing batch #${batchNumber}...`);

      const response = await admin.graphql(
        `#graphql
        query GetCustomers($first: Int!, $after: String) {
          customers(first: $first, after: $after) {
            edges {
              node {
                id
                firstName
                lastName
                email
                phone
                defaultAddress {
                  address1
                  address2
                  city
                  province
                  country
                  zip
                  phone
                }
                createdAt
                updatedAt
                tags
                lifetimeDuration
              }
              cursor
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }`,
        {
          variables: {
            first: BATCH_SIZE,
            after: cursor,
          },
        },
      );

      const responseJson = await response.json();
      // console.log(responseJson);
      const customers = responseJson.data.customers.edges.map(
        (edge: any) => edge.node,
      );

      console.log(responseJson.data.customers.pageInfo);
      hasNextPage = responseJson.data.customers.pageInfo.hasNextpage;

      // console.log(`Batch #${batchNumber}: Found ${customers.length} customers`);

      // Add batch to all customers
      allCustomers = [...allCustomers, ...customers];

      console.log(allCustomers.length, "customers in total");
      console.log(`Sending batch #${batchNumber} to external API...`);
      //Send current batch to API
      const externalApiResponse = await fetch(
        "http://localhost:3000/api/shopify-customer-sync",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            shop: session.shop,
            customers,
            isBatch: true,
            batchSize: BATCH_SIZE,
            batchNumber,
            totalProcessed: allCustomers.length,
          }),
        },
      );

      if (!externalApiResponse.ok) {
        console.error(
          `Batch #${batchNumber} failed with status: ${externalApiResponse.status}`,
        );
        throw new Error(
          `API call failed with status: ${externalApiResponse.status}`,
        );
      }

      console.log(`Batch #${batchNumber} successfully processed`);

      // Update pagination info
      // hasNextPage = responseJson.data.customers.pageInfo.hasNextPage;
      // cursor = responseJson.data.customers.pageInfo.endCursor;

      console.log(`Total customers processed so far: ${allCustomers.length}`);
      console.log(`Has next page: ${hasNextPage}`);
    }

    console.log("Customer sync completed successfully!");
    console.log(`Total customers synchronized: ${allCustomers.length}`);

    return json({
      success: true,
      message: `Successfully synchronized ${allCustomers.length} customers to external API.`,
      totalCustomers: allCustomers.length,
      totalBatches: batchNumber,
      customers: allCustomers,
    });
  } catch (error) {
    console.error("Error syncing customers:", error);
    return json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "An unknown error occurred while syncing customers.",
      customers: [],
    });
  }
};

export default function Customers() {
  const fetcher = useFetcher<typeof action>();
  const loaderData = useLoaderData<typeof loader>();

  const [isSyncing, setIsSyncing] = useState(false);

  const shopify = useAppBridge();

  const handleCustomerSync = () => {
    setIsSyncing(true);
    fetcher.submit({}, { method: "POST" });
  };

  useEffect(() => {
    if (fetcher.data) {
      setIsSyncing(false);

      if (fetcher.data.success) {
        shopify.toast.show("Customers synchronized successfully", {
          isError: false,
          duration: 5000,
        });
      } else {
        shopify.toast.show(`Sync failed: ${fetcher.data.message}`, {
          isError: true,
          duration: 5000,
        });
      }
    }
  }, [fetcher.data, shopify]);

  return (
    <Page>
      <TitleBar title="Customer Sync" />
      <BlockStack gap="500">
        <Layout>
          <Layout.Section>
            <Card>
              <BlockStack gap="400">
                <Text as="h2" variant="headingMd">
                  Customer Synchronization
                </Text>

                {!loaderData.isConnected && (
                  <Banner title="API Connection Required" tone="warning">
                    You need to configure your API key before syncing customers.
                    Please go to the home page to set up your API connection.
                  </Banner>
                )}

                {fetcher.data?.success && (
                  <Banner title="Success" tone="success">
                    {fetcher.data.message}
                  </Banner>
                )}

                {fetcher.data?.success === false && (
                  <Banner title="Sync Failed" tone="critical">
                    {fetcher.data.message}
                  </Banner>
                )}

                <BlockStack gap="200">
                  <Text variant="bodyMd" as="p">
                    Click the button below to synchronize all your Shopify
                    customers with our external system. This will:
                  </Text>
                  <ul style={{ marginLeft: "20px", listStyleType: "disc" }}>
                    <li>Fetch all customers from your Shopify store</li>
                    <li>Send the customer data to our API</li>
                    <li>Update record keeping in the external system</li>
                  </ul>
                </BlockStack>

                {isSyncing && (
                  <BlockStack gap="200">
                    <Text variant="bodyMd" as="p" fontWeight="bold">
                      Synchronizing customers...
                    </Text>
                    <ProgressBar
                      progress={100}
                      size="small"
                      tone="primary"
                      animated
                    />
                  </BlockStack>
                )}

                <div style={{ marginTop: "10px" }}>
                  <Button
                    variant="primary"
                    onClick={handleCustomerSync}
                    disabled={!loaderData.isConnected || isSyncing}
                    loading={isSyncing}
                  >
                    {isSyncing ? "Syncing..." : "Sync Customers Now"}
                  </Button>
                </div>

                {loaderData.isConnected && (
                  <InlineStack align="start" gap="200">
                    <InlineStack gap="200" align="center">
                      <Icon source={CheckIcon} tone="success" />
                      <Text as="span" variant="bodyMd">
                        API Connected
                      </Text>
                    </InlineStack>
                    <Text as="span" variant="bodyMd">
                      Shop: {loaderData.shop}
                    </Text>
                  </InlineStack>
                )}
              </BlockStack>
            </Card>

            {fetcher.data?.success && fetcher.data.customers.length > 0 && (
              <div style={{ marginTop: "20px" }}>
                <Card>
                  <BlockStack gap="400">
                    <Text as="h2" variant="headingMd">
                      Sync Results
                    </Text>
                    <Text variant="bodyMd" as="p">
                      Successfully synchronized {fetcher.data.customers.length}{" "}
                      customers.
                    </Text>
                    <Text variant="bodyLg" as="p" fontWeight="bold">
                      Last sync: {new Date().toLocaleString()}
                    </Text>
                  </BlockStack>
                </Card>
              </div>
            )}
          </Layout.Section>

          <Layout.Section variant="oneThird">
            <Card>
              <BlockStack gap="200">
                <Text as="h2" variant="headingMd">
                  About Customer Sync
                </Text>
                <Text variant="bodyMd" as="p">
                  The customer sync feature helps you keep your external systems
                  up-to-date with your Shopify customer data.
                </Text>
                <Text variant="bodyMd" as="p">
                  We recommend running a sync:
                </Text>
                <ul style={{ marginLeft: "20px", listStyleType: "disc" }}>
                  <li>After importing customers in bulk</li>
                  <li>When setting up the app for the first time</li>
                  <li>If you notice discrepancies between systems</li>
                </ul>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
