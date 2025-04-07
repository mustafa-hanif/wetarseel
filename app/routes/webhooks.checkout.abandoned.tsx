// filepath: /Users/mustafa.hanif/code/wetarseel/app/routes/webhooks.checkout.abandoned.tsx
import type { ActionFunctionArgs } from "@remix-run/node";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

// Define the time threshold after which a cart is considered abandoned (in minutes)
const ABANDONMENT_THRESHOLD_MINUTES = 60; // 1 hour

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, shop, topic } = await authenticate.webhook(request);
  
  console.log(`Received ${topic} webhook for ${shop}`);

  try {
    // Extract checkout information from payload
    const checkout = payload;
    const cartToken = checkout.cart_token;
    const customerId = checkout.customer?.id;
    const email = checkout.email;
    const abandonedCheckoutUrl = checkout.abandoned_checkout_url;
    const totalPrice = checkout.total_price;
    const completedAt = checkout.completed_at;
    const updatedAt = checkout.updated_at;
    
    // Skip if the cart is already completed
    if (completedAt) {
      console.log(`Checkout ${cartToken} is already completed, skipping.`);
      return new Response();
    }
    
    // Calculate time elapsed since last update
    const updatedAtDate = new Date(updatedAt);
    const currentDate = new Date();
    const timeDiffMs = currentDate.getTime() - updatedAtDate.getTime();
    const minutesElapsed = Math.floor(timeDiffMs / (1000 * 60));
    
    // Only consider abandoned if enough time has passed since the last update
    if (minutesElapsed >= ABANDONMENT_THRESHOLD_MINUTES) {
      console.log(`Abandoned cart detected for ${shop} - Cart token: ${cartToken} - Idle for ${minutesElapsed} minutes`);
      
      // Get shop's API key from session
      const shopSession = await prisma.session.findFirst({
        where: { shop }
      });
      
      // Use type assertion since TypeScript doesn't recognize apiKey field
      const sessionData = shopSession as any;
      const apiKey = sessionData?.apiKey;
      
      if (apiKey) {
        // Make API call to external service
        const apiUrl = "https://your-api-endpoint.com/abandoned-cart";
        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            shop,
            cartToken,
            customerId,
            email,
            abandonedCheckoutUrl,
            totalPrice,
            items: checkout.line_items,
            createdAt: checkout.created_at,
            updatedAt: checkout.updated_at,
            minutesIdle: minutesElapsed
          })
        });
        
        if (!response.ok) {
          throw new Error(`API call failed with status: ${response.status}`);
        }
        
        console.log(`Successfully notified external API about abandoned cart from ${shop}`);
      } else {
        console.log(`No API key configured for shop ${shop}`);
      }
    } else {
      console.log(`Checkout ${cartToken} last updated ${minutesElapsed} minutes ago, not considered abandoned yet.`);
    }
  } catch (error) {
    console.error("Error processing abandoned cart webhook:", error);
    // We still return 200 to acknowledge receipt of the webhook
  }
  
  // Return a 200 response to acknowledge the webhook
  return new Response();
};