app.post("/create-cart-checkout-session", async (req, res) => {
    try {
        const { items, email, displayCurrency } = req.body;

        if (!isValidEmail(email)) {
            return res.status(400).json({
                error: "Please provide a valid email address."
            });
        }

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({
                error: "Your cart is empty."
            });
        }

        const line_items = [];

        let cartTotal = 0;

        for (const item of items) {

            /*
             * Accept both:
             * item.product
             * item.productId
             *
             * This prevents the "Invalid product: undefined"
             * problem if the frontend sends productId.
             */

            const productId =
                item.product ||
                item.productId;

            const product =
                products[productId];

            if (!product) {
                return res.status(400).json({
                    error: `Invalid product: ${productId}`
                });
            }

            const amount =
                Number(item.amount);

            if (
                !Number.isFinite(amount) ||
                !product.amounts.includes(amount)
            ) {
                return res.status(400).json({
                    error:
                        `Invalid amount for ${product.name}.`
                });
            }

            const quantity =
                Math.max(
                    1,
                    Number(item.quantity || 1)
                );

            const total =
                amount + product.fee;

            cartTotal +=
                total * quantity;

            line_items.push({
                price_data: {
                    currency: "usd",

                    product_data: {
                        name:
                            `${product.name} Gift Card`,

                        description:
                            `GIFty ${product.name} digital gift card`
                    },

                    unit_amount:
                        Math.round(
                            total * 100
                        )
                },

                quantity:
                    quantity
            });
        }

        const currency =
            typeof displayCurrency === "string" &&
            SUPPORTED_CURRENCIES[
                displayCurrency.toUpperCase()
            ]
                ? displayCurrency.toUpperCase()
                : "USD";

        const customerEmail =
            email.trim();

        const session =
            await stripe.checkout.sessions.create({

                mode: "payment",

                customer_email:
                    customerEmail,

                /*
                 * Stripe will send the customer
                 * a payment receipt to this email.
                 */
                payment_intent_data: {
                    receipt_email:
                        customerEmail
                },

                line_items,

                metadata: {
                    orderType:
                        "cart",

                    customerEmail:
                        customerEmail,

                    displayCurrency:
                        currency,

                    cartItems:
                        JSON.stringify(
                            items.map(item => ({
                                product:
                                    item.product ||
                                    item.productId,

                                amount:
                                    Number(
                                        item.amount
                                    ),

                                quantity:
                                    Number(
                                        item.quantity ||
                                        1
                                    )
                            }))
                        ),

                    totalUSD:
                        cartTotal.toFixed(2)
                },

                billing_address_collection:
                    "auto",

                allow_promotion_codes:
                    true,

                success_url:
                    `${FRONTEND_URL}/?payment=success&session_id={CHECKOUT_SESSION_ID}`,

                cancel_url:
                    `${FRONTEND_URL}/?payment=cancelled`
            });

        return res.json({
            success: true,
            url: session.url,
            sessionId: session.id
        });

    } catch (error) {

        console.error(
            "Cart checkout creation error:",
            error
        );

        return res.status(500).json({
            error:
                "Unable to create cart checkout."
        });
    }
});
