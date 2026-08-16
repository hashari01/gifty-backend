app.post("/create-cart-checkout-session", async (req, res) => {
    try {

        const {
            items,
            email,
            displayCurrency
        } = req.body;

        /* ================================
           VALIDATE EMAIL
        ================================= */

        if (!isValidEmail(email)) {
            return res.status(400).json({
                error: "Please provide a valid email address."
            });
        }

        /* ================================
           VALIDATE CART
        ================================= */

        if (
            !Array.isArray(items) ||
            items.length === 0
        ) {
            return res.status(400).json({
                error: "Your cart is empty."
            });
        }

        const line_items = [];

        let cartTotal = 0;

        /* ================================
           BUILD STRIPE ITEMS
        ================================= */

        for (const item of items) {

            /*
             * Your HTML sends:
             *
             * productId
             *
             * but older code expected:
             *
             * product
             *
             * We support BOTH.
             */

            const productId =
                item.productId ||
                item.product;

            if (!productId) {
                return res.status(400).json({
                    error: "Cart item is missing a product ID."
                });
            }

            const product =
                products[productId];

            if (!product) {
                return res.status(400).json({
                    error:
                        `Invalid product: ${productId}`
                });
            }

            /* ================================
               VALIDATE AMOUNT
            ================================= */

            const amount =
                Number(item.amount);

            if (
                !Number.isFinite(amount) ||
                !Array.isArray(product.amounts) ||
                !product.amounts.includes(amount)
            ) {
                return res.status(400).json({
                    error:
                        `Invalid amount for ${product.name}.`
                });
            }

            /* ================================
               FEE
            ================================= */

            const fee =
                Number(product.fee) || 0;

            const total =
                amount + fee;

            cartTotal += total;

            /* ================================
               STRIPE LINE ITEM
            ================================= */

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
                    Number(item.quantity) || 1

            });

        }

        /* ================================
           DISPLAY CURRENCY
        ================================= */

        const currency =
            typeof displayCurrency === "string" &&
            SUPPORTED_CURRENCIES[
                displayCurrency.toUpperCase()
            ]
                ? displayCurrency.toUpperCase()
                : "USD";

        /* ================================
           STRIPE CHECKOUT
        ================================= */

        const session =
            await stripe.checkout.sessions.create({

                mode:
                    "payment",

                customer_email:
                    email.trim(),

                line_items,

                metadata: {

                    orderType:
                        "cart",

                    customerEmail:
                        email.trim(),

                    displayCurrency:
                        currency,

                    cartItems:
                        JSON.stringify(
                            items.map(item => ({

                                product:
                                    item.productId ||
                                    item.product,

                                amount:
                                    Number(item.amount),

                                quantity:
                                    Number(
                                        item.quantity
                                    ) || 1,

                                email:
                                    item.email ||
                                    email.trim()

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

        /* ================================
           RETURN STRIPE URL
        ================================= */

        return res.json({

            success:
                true,

            url:
                session.url,

            sessionId:
                session.id

        });

    } catch (error) {

        console.error(
            "Cart checkout creation error:",
            error
        );

        return res.status(500).json({

            error:
                error.message ||
                "Unable to create cart checkout."

        });

    }

});
