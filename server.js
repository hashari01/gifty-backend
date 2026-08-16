require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const { Resend } = require("resend");

const app = express();

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);


/* =========================================================
   CORS
========================================================= */

app.use(cors({
    origin: process.env.FRONTEND_URL
}));


/* =========================================================
   HOME
========================================================= */

app.get("/", (req, res) => {

    res.json({
        service: "GIFty API",
        status: "online"
    });

});


/* =========================================================
   STRIPE WEBHOOK
========================================================= */

app.post("/webhook", express.raw({
    type: "application/json"
}), async (req, res) => {

    try {

        const signature =
            req.headers["stripe-signature"];

        const event =
            stripe.webhooks.constructEvent(
                req.body,
                signature,
                process.env.STRIPE_WEBHOOK_SECRET
            );


        if (
            event.type ===
            "checkout.session.completed"
        ) {

            const session =
                event.data.object;

            const metadata =
                session.metadata || {};


            const product =
                metadata.productId ||
                "Unknown";


            const giftCardValue =
                metadata.giftCardValue ||
                "Unknown";


            const fee =
                metadata.giftyFee ||
                "Unknown";


            const email =
                metadata.customerEmail ||
                session.customer_details?.email ||
                "Unknown";


            const total = (
                (session.amount_total || 0) / 100
            ).toFixed(2);


            console.log(
                "NEW GIFty ORDER"
            );

            console.log(
                "Product:",
                product
            );

            console.log(
                "Gift card:",
                giftCardValue
            );

            console.log(
                "Fee:",
                fee
            );

            console.log(
                "Customer:",
                email
            );

            console.log(
                "Total:",
                total
            );


            await resend.emails.send({

                from:
                    "GIFty <onboarding@resend.dev>",

                to: [
                    process.env.OWNER_EMAIL
                ],

                subject:
                    `🎁 New GIFty Order — ${product}`,

                html: `

                    <h1>
                        🎁 New GIFty Order
                    </h1>

                    <p>
                        <strong>
                            Product:
                        </strong>

                        ${product}
                    </p>

                    <p>
                        <strong>
                            Gift Card:
                        </strong>

                        $${giftCardValue}
                    </p>

                    <p>
                        <strong>
                            GIFty Fee:
                        </strong>

                        $${fee}
                    </p>

                    <p>
                        <strong>
                            Total Paid:
                        </strong>

                        $${total}
                    </p>

                    <p>
                        <strong>
                            Customer Email:
                        </strong>

                        ${email}
                    </p>

                    <hr>

                    <p>
                        <strong>
                            Status:
                        </strong>

                        PAID — PROCESSING
                    </p>

                `
            });


            console.log(
                "Order notification sent."
            );

        }


        res.json({
            received: true
        });


    } catch (error) {

        console.error(
            "Webhook error:",
            error.message
        );

        res.status(400)
            .send("Webhook Error");

    }

});


/* =========================================================
   JSON
========================================================= */

app.use(express.json());


/* =========================================================
   EXCHANGE RATES
========================================================= */

const SUPPORTED_CURRENCIES = [

    "USD",
    "TND",
    "EUR",
    "GBP",
    "CAD",
    "AUD",
    "AED",
    "SAR",
    "MAD",
    "DZD",
    "EGP",
    "TRY",
    "JPY",
    "CHF"

];


app.get(
    "/exchange-rates",
    async (req, res) => {

        try {

            /*
             * Frankfurter uses USD as
             * the base currency.
             */

            const response =
                await fetch(
                    "https://api.frankfurter.app/latest?from=USD"
                );


            if (!response.ok) {

                throw new Error(
                    `Exchange rate API returned ${response.status}`
                );

            }


            const data =
                await response.json();


            const rates = {
                USD: 1
            };


            /*
             * Add every currency that
             * the provider actually returns.
             */

            SUPPORTED_CURRENCIES.forEach(
                currency => {

                    if (
                        currency === "USD"
                    ) {
                        return;
                    }


                    if (
                        data.rates &&
                        typeof data.rates[currency]
                            === "number"
                    ) {

                        rates[currency] =
                            data.rates[currency];

                    }

                }
            );


            res.json({

                base: "USD",

                rates: rates,

                date:
                    data.date || null

            });


        } catch (error) {

            console.error(
                "Exchange rate error:",
                error.message
            );


            res.status(500).json({

                error:
                    "Unable to load exchange rates."

            });

        }

    }
);


/* =========================================================
   PRODUCTS
========================================================= */

const products = {


    /* =====================================================
       GAMING
    ===================================================== */

    steam: {

        name:
            "Steam",

        amounts:
            [5, 10, 20, 50, 100],

        fee:
            1.49

    },


    playstation: {

        name:
            "PlayStation Store",

        amounts:
            [10, 20, 25, 50, 100],

        fee:
            1.49

    },


    xbox: {

        name:
            "Xbox",

        amounts:
            [10, 15, 25, 50, 100],

        fee:
            1.49

    },


    roblox: {

        name:
            "Roblox",

        amounts:
            [10, 20, 25, 50, 100],

        fee:
            1.49

    },


    nintendo: {

        name:
            "Nintendo eShop",

        amounts:
            [10, 20, 35, 50, 100],

        fee:
            1.49

    },


    razergold: {

        name:
            "Razer Gold",

        amounts:
            [10, 20, 50, 100],

        fee:
            1.49

    },


    riotgames: {

        name:
            "Riot Games",

        amounts:
            [10, 20, 25, 50, 100],

        fee:
            1.49

    },


    epicgames: {

        name:
            "Epic Games",

        amounts:
            [10, 20, 25, 50, 100],

        fee:
            1.49

    },


    minecraft: {

        name:
            "Minecraft",

        amounts:
            [10, 20, 30, 50],

        fee:
            1.49

    },


    pubgmobile: {

        name:
            "PUBG Mobile",

        amounts:
            [10, 20, 30, 50, 100],

        fee:
            1.49

    },


    /* =====================================================
       MUSIC
    ===================================================== */

    spotify: {

        name:
            "Spotify",

        amounts:
            [10, 20, 30, 50],

        fee:
            1.49

    },


    /* =====================================================
       APPS
    ===================================================== */

    apple: {

        name:
            "Apple Gift Card",

        amounts:
            [10, 25, 50, 100],

        fee:
            1.99

    },


    googleplay: {

        name:
            "Google Play",

        amounts:
            [10, 20, 25, 50, 100],

        fee:
            1.49

    },


    discord: {

        name:
            "Discord",

        amounts:
            [10, 20, 50],

        fee:
            1.49

    },


    microsoft: {

        name:
            "Microsoft",

        amounts:
            [10, 25, 50, 100],

        fee:
            1.49

    },


    /* =====================================================
       STREAMING
    ===================================================== */

    netflix: {

        name:
            "Netflix",

        amounts:
            [15, 25, 50, 100],

        fee:
            1.99

    },


    crunchyroll: {

        name:
            "Crunchyroll",

        amounts:
            [10, 25, 50],

        fee:
            1.49

    },


    youtube: {

        name:
            "YouTube",

        amounts:
            [10, 20, 25, 50, 100],

        fee:
            1.49

    },


    /* =====================================================
       SHOPPING
    ===================================================== */

    amazon: {

        name:
            "Amazon",

        amounts:
            [10, 25, 50, 100],

        fee:
            1.99

    },


    ikea: {

        name:
            "IKEA",

        amounts:
            [10, 25, 50, 100],

        fee:
            1.99

    },


    zalando: {

        name:
            "Zalando",

        amounts:
            [10, 25, 50, 100],

        fee:
            1.99

    },


    /* =====================================================
       TRAVEL
    ===================================================== */

    uber: {

        name:
            "Uber",

        amounts:
            [10, 20, 50, 100],

        fee:
            1.99

    },


    ubereats: {

        name:
            "Uber Eats",

        amounts:
            [10, 20, 50, 100],

        fee:
            1.99

    },


    airbnb: {

        name:
            "Airbnb",

        amounts:
            [25, 50, 100, 200],

        fee:
            2.49

    },


    booking: {

        name:
            "Booking.com",

        amounts:
            [25, 50, 100, 200],

        fee:
            2.49

    }

};


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


            /* =================================================
               FIND PRODUCT
            ================================================= */

            const product =
                products[productId];


            if (!product) {

                return res.status(400).json({

                    error:
                        "Invalid product."

                });

            }


            /* =================================================
               VALIDATE AMOUNT
            ================================================= */

            const numericAmount =
                Number(amount);


            if (
                !Number.isFinite(
                    numericAmount
                ) ||

                !product.amounts.includes(
                    numericAmount
                )
            ) {

                return res.status(400).json({

                    error:
                        "Invalid gift card amount."

                });

            }


            /* =================================================
               VALIDATE EMAIL
            ================================================= */

            if (
                typeof email !== "string" ||
                !email.includes("@")
            ) {

                return res.status(400).json({

                    error:
                        "Invalid email."

                });

            }


            /* =================================================
               CALCULATE TOTAL
            ================================================= */

            const total =
                numericAmount +
                product.fee;


            /* =================================================
               CREATE STRIPE SESSION
            ================================================= */

            const session =
                await stripe
                    .checkout
                    .sessions
                    .create({

                        mode:
                            "payment",


                        customer_email:
                            email,


                        line_items: [

                            {

                                price_data: {

                                    /*
                                     * IMPORTANT:
                                     *
                                     * Stripe still charges
                                     * the customer in USD.
                                     *
                                     * The currency selector
                                     * only changes the
                                     * DISPLAYED estimate.
                                     */

                                    currency:
                                        "usd",


                                    product_data: {

                                        name:
                                            `${product.name} Gift Card`,


                                        description:
                                            `GIFty ${product.name} gift card`

                                    },


                                    unit_amount:
                                        Math.round(
                                            total * 100
                                        )

                                },


                                quantity:
                                    1

                            }

                        ],


                        metadata: {

                            productId:
                                productId,


                            giftCardValue:
                                numericAmount
                                    .toFixed(2),


                            giftyFee:
                                product.fee
                                    .toFixed(2),


                            customerEmail:
                                email

                        },


                        success_url:
                            "https://hashari01.github.io/gifty/?payment=success",


                        cancel_url:
                            "https://hashari01.github.io/gifty/?payment=cancelled"

                    });


            res.json({

                url:
                    session.url

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
