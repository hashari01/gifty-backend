require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const { Resend } = require("resend");

const app = express();

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const resend = new Resend(
    process.env.RESEND_API_KEY
);


/* =========================================================
   CORS
========================================================= */

app.use(cors({
    origin: process.env.FRONTEND_URL
}));


/* =========================================================
   HOME / HEALTH CHECK
========================================================= */

app.get("/", (req, res) => {
    res.json({
        service: "GIFty API",
        status: "online"
    });
});


/* =========================================================
   STRIPE WEBHOOK
   IMPORTANT:
   This MUST come before express.json()
========================================================= */

app.post(
    "/webhook",
    express.raw({
        type: "application/json"
    }),
    async (req, res) => {

        const signature =
            req.headers["stripe-signature"];

        let event;

        try {

            event =
                stripe.webhooks.constructEvent(
                    req.body,
                    signature,
                    process.env.STRIPE_WEBHOOK_SECRET
                );

        } catch (error) {

            console.error(
                "Webhook signature error:",
                error.message
            );

            return res
                .status(400)
                .send(
                    `Webhook Error: ${error.message}`
                );
        }


        /* =================================================
           PAYMENT SUCCESS
        ================================================= */

        if (
            event.type ===
            "checkout.session.completed"
        ) {

            const session =
                event.data.object;


            const metadata =
                session.metadata || {};


            const productId =
                metadata.productId ||
                "Unknown";


            const giftCardValue =
                metadata.giftCardValue ||
                "Unknown";


            const giftyFee =
                metadata.giftyFee ||
                "Unknown";


            const customerEmail =
                metadata.customerEmail ||
                session.customer_details?.email ||
                "Unknown";


            const totalPaid =
                (
                    (session.amount_total || 0) /
                    100
                ).toFixed(2);


            const orderId =
                session.id;


            console.log(
                "GIFty payment received:",
                orderId
            );


            /* =============================================
               SEND YOU AN EMAIL
            ============================================= */

            try {

                const { data, error } =
                    await resend.emails.send({

                        from:
                            "GIFty <onboarding@resend.dev>",

                        to:
                            [process.env.OWNER_EMAIL],

                        subject:
                            `🔔 New GIFty Order — ${productId}`,

                        html: `

                            <div style="
                                font-family:Arial,sans-serif;
                                max-width:600px;
                                margin:auto;
                                color:#171717;
                            ">

                                <h1>
                                    🎁 New GIFty Order
                                </h1>

                                <p>
                                    A customer has successfully
                                    paid for an order.
                                </p>

                                <hr>

                                <h2>
                                    Order Details
                                </h2>

                                <p>
                                    <strong>Order ID:</strong>
                                    ${orderId}
                                </p>

                                <p>
                                    <strong>Product:</strong>
                                    ${productId}
                                </p>

                                <p>
                                    <strong>Gift Card Value:</strong>
                                    $${giftCardValue}
                                </p>

                                <p>
                                    <strong>GIFty Fee:</strong>
                                    $${giftyFee}
                                </p>

                                <p>
                                    <strong>Total Paid:</strong>
                                    $${totalPaid}
                                </p>

                                <p>
                                    <strong>Customer Email:</strong>
                                    ${customerEmail}
                                </p>

                                <hr>

                                <h2>
                                    ⚡ Action Required
                                </h2>

                                <p>
                                    Manually purchase the
                                    appropriate gift card and
                                    send the code to the customer.
                                </p>

                                <p>
                                    <strong>Status:</strong>
                                    PAID — PROCESSING
                                </p>

                            </div>

                        `

                    });


                if (error) {

                    console.error(
                        "Resend error:",
                        error
                    );

                } else {

                    console.log(
                        "Owner notification sent:",
                        data
                    );

                }

            } catch (emailError) {

                console.error(
                    "Email notification failed:",
                    emailError
                );

            }

        }


        /* =================================================
           TELL STRIPE WE RECEIVED THE EVENT
        ================================================= */

        res.json({
            received: true
        });

    }
);


/* =========================================================
   NORMAL JSON REQUESTS
   This MUST come after /webhook
========================================================= */

app.use(express.json());


/* =========================================================
   CREATE STRIPE CHECKOUT
========================================================= */

app.post(
    "/create-checkout-session",
    async (req, res) => {

        try {

            const {
                productId,
                amount,
                email
            } = req.body;


            /* =============================================
               PRODUCTS
            ============================================= */

            const products = {

                steam: {
                    name: "Steam",
                    amounts: [
                        5,
                        10,
                        20,
                        50,
                        100
                    ],
                    fee: 1.49
                },

                spotify: {
                    name: "Spotify",
                    amounts: [
                        10,
                        20,
                        30,
                        50
                    ],
                    fee: 1.49
                },

                roblox: {
                    name: "Roblox",
                    amounts: [
                        10,
                        20,
                        25,
                        50,
                        100
                    ],
                    fee: 1.49
                },

                playstation: {
                    name: "PlayStation Store",
                    amounts: [
                        10,
                        20,
                        25,
                        50,
                        100
                    ],
                    fee: 1.49
                },

                xbox: {
                    name: "Xbox",
                    amounts: [
                        10,
                        15,
                        25,
                        50,
                        100
                    ],
                    fee: 1.49
                },

                apple: {
                    name: "Apple Gift Card",
                    amounts: [
                        10,
                        25,
                        50,
                        100
                    ],
                    fee: 1.99
                },

                googleplay: {
                    name: "Google Play",
                    amounts: [
                        10,
                        20,
                        25,
                        50,
                        100
                    ],
                    fee: 1.49
                },

                netflix: {
                    name: "Netflix",
                    amounts: [
                        15,
                        25,
                        50,
                        100
                    ],
                    fee: 1.99
                }

            };


            /* =============================================
               CHECK PRODUCT
            ============================================= */

            const product =
                products[productId];


            if (!product) {

                return res.status(400).json({
                    error: "Invalid product."
                });

            }


            /* =============================================
               CHECK AMOUNT
            ============================================= */

            const numericAmount =
                Number(amount);


            if (
                !product.amounts.includes(
                    numericAmount
                )
            ) {

                return res.status(400).json({
                    error:
                        "Invalid gift card amount."
                });

            }


            /* =============================================
               CHECK EMAIL
            ============================================= */

            if (
                typeof email !== "string" ||
                !email.includes("@")
            ) {

                return res.status(400).json({
                    error:
                        "Invalid email."
                });

            }


            /* =============================================
               TOTAL
            ============================================= */

            const total =
                numericAmount +
                product.fee;


            /* =============================================
               CREATE STRIPE SESSION
            ============================================= */

            const session =
                await stripe.checkout.sessions.create({

                    mode: "payment",

                    customer_email:
                        email,

                    line_items: [

                        {

                            price_data: {

                                currency: "usd",

                                product_data: {

                                    name:
                                        `${product.name} Gift Card`,

                                    description:
                                        `GIFty ${product.name} gift card — $${numericAmount.toFixed(2)}`
                                },

                                unit_amount:
                                    Math.round(
                                        total * 100
                                    )

                            },

                            quantity: 1

                        }

                    ],


                    /* =====================================
                       SAVE ORDER INFORMATION
                    ===================================== */

                    metadata: {

                        productId:
                            productId,

                        giftCardValue:
                            numericAmount.toFixed(2),

                        giftyFee:
                            product.fee.toFixed(2),

                        customerEmail:
                            email

                    },


                    /* =====================================
                       RETURN URLS
                    ===================================== */

                    success_url:
                        "https://hashari01.github.io/gifty/?payment=success",

                    cancel_url:
                        "https://hashari01.github.io/gifty/?payment=cancelled"

                });


            /* =============================================
               SEND CHECKOUT URL TO WEBSITE
            ============================================= */

            res.json({
                url: session.url
            });


        } catch (error) {

            console.error(
                "Checkout error:",
                error
            );

            res.status(500).json({
                error:
                    "Unable to create checkout."
            });

        }

    }
);


/* =========================================================
   START SERVER
========================================================= */

const PORT =
    process.env.PORT || 3000;


app.listen(
    PORT,
    () => {

        console.log(
            `GIFty API running on port ${PORT}`
        );

    }
);
