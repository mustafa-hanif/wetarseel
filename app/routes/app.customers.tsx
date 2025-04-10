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
    return json({
      success: false,
      message:
        "API key is not configured. Please set up your API key in the app settings.",
      customers: [],
    });
  }

  try {
    // Query customers from Shopify using GraphQL
    const response = await admin.graphql(
      `#graphql
      query GetCustomers($first: Int!) {
        customers(first: $first) {
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
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }`,
      {
        variables: {
          first: 50, // Fetch first 50 customers
        },
      },
    );

    const responseJson = await response.json();
    const customers = responseJson.data.customers.edges.map(
      (edge: any) => edge.node,
    );

    // Send customers to the external API
    const externalApiResponse = await fetch(
      "http://localhost:3000/api/customer-sync",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          shop: session.shop,
          customers,
          syncDate: new Date().toISOString(),
        }),
      },
    );

    if (!externalApiResponse.ok) {
      throw new Error(
        `API call failed with status: ${externalApiResponse.status}`,
      );
    }

    const apiResult = await externalApiResponse.json();

    return json({
      success: true,
      message: `Successfully synchronized ${customers.length} customers to external API.`,
      customers,
      apiResult,
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
