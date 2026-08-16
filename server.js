require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const { Resend } = require("resend");

const app = express();

const PORT = process.env.PORT || 3000;
const FRONTEND_URL = process.env.FRONTEND_URL;

if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("Missing STRIPE_SECRET_KEY");
}

if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.warn(
        "WARNING: STRIPE_WEBHOOK_SECRET is not configured."
    );
}

const stripe = new Stripe(
    process.env.STRIPE_SECRET_KEY
);

const resend = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;


/* =========================================================
   SECURITY / CORS
========================================================= */

app.disable("x-powered-by");

app.use(
    cors({
        origin: FRONTEND_URL || "*",
        methods: ["GET", "POST"],
        allowedHeaders: ["Content-Type"]
    })
);


/* =========================================================
   BASIC HEALTH CHECK
========================================================= */

app.get("/", (req, res) => {

    res.json({
        service: "GIFty API",
        status: "online",
        version: "3.0.0"
    });

});


/* =========================================================
   STRIPE WEBHOOK
   MUST COME BEFORE express.json()
========================================================= */

app.post(
    "/webhook",
    express.raw({
        type: "application/json"
    }),
    async (req, res) => {

        let event;

        try {

            const signature =
                req.headers["stripe-signature"];

            if (!signature) {

                return res.status(400).send(
                    "Missing Stripe signature."
                );

            }

            event =
                stripe.webhooks.constructEvent(
                    req.body,
                    signature,
                    process.env.STRIPE_WEBHOOK_SECRET
                );

        } catch (error) {

            console.error(
                "Webhook signature verification failed:",
                error.message
            );

            return res
                .status(400)
                .send("Webhook Error");

        }


        try {

            switch (event.type) {

                case "checkout.session.completed": {

                    const session =
                        event.data.object;

                    await processCompletedOrder(
                        session
                    );

                    break;

                }


                case "checkout.session.async_payment_succeeded": {

                    const session =
                        event.data.object;

                    await processCompletedOrder(
                        session
                    );

                    break;

                }


                default:

                    console.log(
                        `Unhandled Stripe event: ${event.type}`
                    );

            }


            return res.json({
                received: true
            });

        } catch (error) {

            console.error(
                "Webhook processing error:",
                error
            );

            return res
                .status(500)
                .json({
                    error:
                        "Webhook processing failed."
                });

        }

    }
);


/* =========================================================
   JSON BODY
========================================================= */

app.use(
    express.json({
        limit: "100kb"
    })
);


/* =========================================================
   SUPPORTED CURRENCIES
========================================================= */

const SUPPORTED_CURRENCIES = {

    USD: {
        name: "US Dollar",
        flag: "🇺🇸",
        decimals: 2
    },

    EUR: {
        name: "Euro",
        flag: "🇪🇺",
        decimals: 2
    },

    GBP: {
        name: "British Pound",
        flag: "🇬🇧",
        decimals: 2
    },

    CAD: {
        name: "Canadian Dollar",
        flag: "🇨🇦",
        decimals: 2
    },

    AUD: {
        name: "Australian Dollar",
        flag: "🇦🇺",
        decimals: 2
    },

    TND: {
        name: "Tunisian Dinar",
        flag: "🇹🇳",
        decimals: 3
    },

    DZD: {
        name: "Algerian Dinar",
        flag: "🇩🇿",
        decimals: 2
    },

    MAD: {
        name: "Moroccan Dirham",
        flag: "🇲🇦",
        decimals: 2
    },

    EGP: {
        name: "Egyptian Pound",
        flag: "🇪🇬",
        decimals: 2
    },

    SAR: {
        name: "Saudi Riyal",
        flag: "🇸🇦",
        decimals: 2
    },

    AED: {
        name: "UAE Dirham",
        flag: "🇦🇪",
        decimals: 2
    },

    QAR: {
        name: "Qatari Riyal",
        flag: "🇶🇦",
        decimals: 2
    },

    KWD: {
        name: "Kuwaiti Dinar",
        flag: "🇰🇼",
        decimals: 3
    },

    JOD: {
        name: "Jordanian Dinar",
        flag: "🇯🇴",
        decimals: 3
    },

    TRY: {
        name: "Turkish Lira",
        flag: "🇹🇷",
        decimals: 2
    },

    JPY: {
        name: "Japanese Yen",
        flag: "🇯🇵",
        decimals: 0
    },

    CNY: {
        name: "Chinese Yuan",
        flag: "🇨🇳",
        decimals: 2
    },

    INR: {
        name: "Indian Rupee",
        flag: "🇮🇳",
        decimals: 2
    },

    CHF: {
        name: "Swiss Franc",
        flag: "🇨🇭",
        decimals: 2
    },

    SEK: {
        name: "Swedish Krona",
        flag: "🇸🇪",
        decimals: 2
    },

    NOK: {
        name: "Norwegian Krone",
        flag: "🇳🇴",
        decimals: 2
    },

    PLN: {
        name: "Polish Zloty",
        flag: "🇵🇱",
        decimals: 2
    },

    BRL: {
        name: "Brazilian Real",
        flag: "🇧🇷",
        decimals: 2
    },

    MXN: {
        name: "Mexican Peso",
        flag: "🇲🇽",
        decimals: 2
    },

    ZAR: {
        name: "South African Rand",
        flag: "🇿🇦",
        decimals: 2
    }

};


/* =========================================================
   EXCHANGE RATE CACHE
========================================================= */

let exchangeRateCache = {

    rates: {
        USD: 1
    },

    date: null,

    timestamp: 0

};

const RATE_CACHE_TIME =
    30 * 60 * 1000;


/* =========================================================
   GET EXCHANGE RATES
========================================================= */

async function getExchangeRates() {

    const now = Date.now();


    if (
        exchangeRateCache.timestamp &&
        now - exchangeRateCache.timestamp <
            RATE_CACHE_TIME
    ) {

        return exchangeRateCache;

    }


    const response =
        await fetch(
            "https://open.er-api.com/v6/latest/USD"
        );


    if (!response.ok) {

        throw new Error(
            `Exchange API returned ${response.status}`
        );

    }


    const data =
        await response.json();


    if (
        data.result !== "success" ||
        !data.rates
    ) {

        throw new Error(
            "Invalid exchange rate response."
        );

    }


    const rates = {
        USD: 1
    };


    Object.keys(
        SUPPORTED_CURRENCIES
    ).forEach(currency => {

        if (currency === "USD") {
            return;
        }


        const rate =
            Number(data.rates[currency]);


        if (
            Number.isFinite(rate) &&
            rate > 0
        ) {

            rates[currency] = rate;

        }

    });


    exchangeRateCache = {

        rates,

        date:
            data.time_last_update_utc ||
            new Date().toISOString(),

        timestamp:
            now

    };


    return exchangeRateCache;

}


/* =========================================================
   EXCHANGE RATE ENDPOINT
========================================================= */

app.get(
    "/exchange-rates",
    async (req, res) => {

        try {

            const data =
                await getExchangeRates();


            res.json({

                base: "USD",

                rates:
                    data.rates,

                date:
                    data.date,

                currencies:
                    SUPPORTED_CURRENCIES

            });

        } catch (error) {

            console.error(
                "Exchange rate error:",
                error.message
            );


            res.status(503).json({

                error:
                    "Exchange rates are temporarily unavailable."

            });

        }

    }
);


/* =========================================================
   PRODUCTS
========================================================= */

const products = {

    steam: {
        name: "Steam",
        amounts: [5, 10, 20, 50, 100],
        fee: 1.49
    },

    playstation: {
        name: "PlayStation Store",
        amounts: [10, 20, 25, 50, 100],
        fee: 1.49
    },

    xbox: {
        name: "Xbox",
        amounts: [10, 15, 25, 50, 100],
        fee: 1.49
    },

    roblox: {
        name: "Roblox",
        amounts: [10, 20, 25, 50, 100],
        fee: 1.49
    },

    nintendo: {
        name: "Nintendo eShop",
        amounts: [10, 20, 35, 50, 100],
        fee: 1.49
    },

    razergold: {
        name: "Razer Gold",
        amounts: [10, 20, 50, 100],
        fee: 1.49
    },

    riotgames: {
        name: "Riot Games",
        amounts: [10, 20, 25, 50, 100],
        fee: 1.49
    },

    epicgames: {
        name: "Epic Games",
        amounts: [10, 20, 25, 50, 100],
        fee: 1.49
    },

    minecraft: {
        name: "Minecraft",
        amounts: [10, 20, 30, 50],
        fee: 1.49
    },

    pubgmobile: {
        name: "PUBG Mobile",
        amounts: [10, 20, 30, 50, 100],
        fee: 1.49
    },

    spotify: {
        name: "Spotify",
        amounts: [10, 20, 30, 50],
        fee: 1.49
    },

    apple: {
        name: "Apple Gift Card",
        amounts: [10, 25, 50, 100],
        fee: 1.99
    },

    googleplay: {
        name: "Google Play",
        amounts: [10, 20, 25, 50, 100],
        fee: 1.49
    },

    discord: {
        name: "Discord",
        amounts: [10, 20, 50],
        fee: 1.49
    },

    microsoft: {
        name: "Microsoft",
        amounts: [10, 25, 50, 100],
        fee: 1.49
    },

    netflix: {
        name: "Netflix",
        amounts: [15, 25, 50, 100],
        fee: 1.99
    },

    crunchyroll: {
        name: "Crunchyroll",
        amounts: [10, 25, 50],
        fee: 1.49
    },

    youtube: {
        name: "YouTube",
        amounts: [10, 20, 25, 50, 100],
        fee: 1.49
    },

    amazon: {
        name: "Amazon",
        amounts: [10, 25, 50, 100],
        fee: 1.99
    },

    ikea: {
        name: "IKEA",
        amounts: [10, 25, 50, 100],
        fee: 1.99
    },

    zalando: {
        name: "Zalando",
        amounts: [10, 25, 50, 100],
        fee: 1.99
    },

    uber: {
        name: "Uber",
        amounts: [10, 20, 50, 100],
        fee: 1.99
    },

    ubereats: {
        name: "Uber Eats",
        amounts: [10, 20, 50, 100],
        fee: 1.99
    },

    airbnb: {
        name: "Airbnb",
        amounts: [25, 50, 100, 200],
        fee: 2.49
    },

    booking: {
        name: "Booking.com",
        amounts: [25, 50, 100, 200],
        fee: 2.49
    }

};


/* =========================================================
   PRODUCTS API
========================================================= */

app.get(
    "/products",
    (req, res) => {

        const publicProducts =
            Object.entries(products)
                .map(([id, product]) => ({

                    id,

                    name:
                        product.name,

                    amounts:
                        product.amounts

                }));


        res.json({
            products: publicProducts
        });

    }
);


/* =========================================================
   EMAIL VALIDATION
========================================================= */

function isValidEmail(email) {

    if (
        typeof email !== "string" ||
        email.length > 254
    ) {

        return false;

    }


    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        .test(email);

}


/* =========================================================
   VALIDATE CURRENCY
========================================================= */

function getValidCurrency(
    displayCurrency
) {

    if (
        typeof displayCurrency !== "string"
    ) {

        return "USD";

    }


    const currency =
        displayCurrency
            .trim()
            .toUpperCase();


    if (
        SUPPORTED_CURRENCIES[currency]
    ) {

        return currency;

    }


    return "USD";

}


/* =========================================================
   VALIDATE SINGLE CART ITEM
========================================================= */

function validateCartItem(item) {

    if (
        !item ||
        typeof item !== "object"
    ) {

        throw new Error(
            "Invalid cart item."
        );

    }


    const productId =
        String(
            item.productId ||
            item.product ||
            ""
        );


    const product =
        products[productId];


    if (!product) {

        throw new Error(
            `Invalid product: ${productId}`
        );

    }


    const amount =
        Number(item.amount);


    if (
        !Number.isFinite(amount) ||
        !product.amounts.includes(amount)
    ) {

        throw new Error(
            `Invalid amount for ${product.name}.`
        );

    }


    return {

        productId,

        product,

        amount,

        fee:
            product.fee,

        total:
            amount + product.fee

    };

}


/* =========================================================
   CREATE SINGLE CHECKOUT
========================================================= */

app.post(
    "/create-checkout-session",
    async (req, res) => {

        try {

            const {
                productId,
                amount,
                email,
                displayCurrency
            } = req.body;


            /* ---------------------------------------------
               PRODUCT
            --------------------------------------------- */

            const product =
                products[productId];


            if (!product) {

                return res.status(400).json({

                    error:
                        "Invalid product."

                });

            }


            /* ---------------------------------------------
               AMOUNT
            --------------------------------------------- */

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


            /* ---------------------------------------------
               EMAIL
            --------------------------------------------- */

            if (!isValidEmail(email)) {

                return res.status(400).json({

                    error:
                        "Please provide a valid email address."

                });

            }


            /* ---------------------------------------------
               CURRENCY
            --------------------------------------------- */

            const currency =
                getValidCurrency(
                    displayCurrency
                );


            /* ---------------------------------------------
               TOTAL
            --------------------------------------------- */

            const total =
                numericAmount +
                product.fee;


            const stripeAmount =
                Math.round(
                    total * 100
                );


            /* ---------------------------------------------
               STRIPE CHECKOUT
            --------------------------------------------- */

            const session =
                await stripe.checkout.sessions.create({

                    mode: "payment",

                    customer_email:
                        email.trim(),

                    line_items: [

                        {

                            price_data: {

                                currency:
                                    "usd",

                                product_data: {

                                    name:
                                        `${product.name} Gift Card`,

                                    description:
                                        `GIFty ${product.name} digital gift card`

                                },

                                unit_amount:
                                    stripeAmount

                            },

                            quantity: 1

                        }

                    ],

                    metadata: {

                        orderType:
                            "single",

                        productId,

                        productName:
                            product.name,

                        giftCardValue:
                            numericAmount.toFixed(2),

                        giftyFee:
                            product.fee.toFixed(2),

                        totalUSD:
                            total.toFixed(2),

                        customerEmail:
                            email.trim(),

                        displayCurrency:
                            currency

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

                url:
                    session.url,

                sessionId:
                    session.id

            });

        } catch (error) {

            console.error(
                "Single checkout creation error:",
                error
            );


            return res.status(500).json({

                error:
                    "Unable to create secure checkout."

            });

        }

    }
);


/* =========================================================
   CREATE CART CHECKOUT
========================================================= */

app.post(
    "/create-cart-checkout-session",
    async (req, res) => {

        try {

            const {
                items,
                email,
                displayCurrency
            } = req.body;


            /* ---------------------------------------------
               ITEMS
            --------------------------------------------- */

            if (
                !Array.isArray(items) ||
                items.length === 0
            ) {

                return res.status(400).json({

                    error:
                        "Your cart is empty."

                });

            }


            /*
             * Prevent extremely large requests.
             */

            if (items.length > 50) {

                return res.status(400).json({

                    error:
                        "Cart contains too many items."

                });

            }


            /* ---------------------------------------------
               EMAIL
            --------------------------------------------- */

            if (!isValidEmail(email)) {

                return res.status(400).json({

                    error:
                        "Please provide a valid email address."

                });

            }


            /* ---------------------------------------------
               CURRENCY
            --------------------------------------------- */

            const currency =
                getValidCurrency(
                    displayCurrency
                );


            /* ---------------------------------------------
               VALIDATE EVERY ITEM
            --------------------------------------------- */

            const validatedItems = [];


            for (
                const item of items
            ) {

                try {

                    const validated =
                        validateCartItem(
                            item
                        );


                    validatedItems.push(
                        validated
                    );

                } catch (error) {

                    return res.status(400).json({

                        error:
                            error.message

                    });

                }

            }


            /* ---------------------------------------------
               STRIPE LINE ITEMS
            --------------------------------------------- */

            const lineItems =
                validatedItems.map(
                    item => ({

                        price_data: {

                            currency:
                                "usd",

                            product_data: {

                                name:
                                    `${item.product.name} Gift Card`,

                                description:
                                    `GIFty ${item.product.name} digital gift card`

                            },

                            unit_amount:
                                Math.round(
                                    item.total * 100
                                )

                        },

                        quantity: 1

                    })
                );


            /* ---------------------------------------------
               TOTALS
            --------------------------------------------- */

            const giftCardTotal =
                validatedItems.reduce(
                    (
                        total,
                        item
                    ) =>
                        total + item.amount,
                    0
                );


            const feeTotal =
                validatedItems.reduce(
                    (
                        total,
                        item
                    ) =>
                        total + item.fee,
                    0
                );


            const totalUSD =
                giftCardTotal +
                feeTotal;


            /* ---------------------------------------------
               ORDER DATA FOR WEBHOOK
            --------------------------------------------- */

            const orderItems =
                validatedItems.map(
                    item => ({

                        productId:
                            item.productId,

                        productName:
                            item.product.name,

                        giftCardValue:
                            item.amount,

                        fee:
                            item.fee,

                        total:
                            item.total

                    })
                );


            /*
             * Stripe metadata values must be strings.
             */

            const orderItemsJSON =
                JSON.stringify(
                    orderItems
                );


            /* ---------------------------------------------
               STRIPE SESSION
            --------------------------------------------- */

            const session =
                await stripe.checkout.sessions.create({

                    mode:
                        "payment",

                    customer_email:
                        email.trim(),

                    line_items:
                        lineItems,

                    metadata: {

                        orderType:
                            "cart",

                        itemCount:
                            String(
                                validatedItems.length
                            ),

                        giftCardTotal:
                            giftCardTotal.toFixed(2),

                        feeTotal:
                            feeTotal.toFixed(2),

                        totalUSD:
                            totalUSD.toFixed(2),

                        customerEmail:
                            email.trim(),

                        displayCurrency:
                            currency,

                        orderItems:
                            orderItemsJSON

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
                    "Unable to create cart checkout."

            });

        }

    }
);


/* =========================================================
   CHECKOUT SESSION LOOKUP
========================================================= */

app.get(
    "/checkout-session/:sessionId",
    async (req, res) => {

        try {

            const session =
                await stripe.checkout.sessions.retrieve(
                    req.params.sessionId
                );


            res.json({

                id:
                    session.id,

                status:
                    session.status,

                paymentStatus:
                    session.payment_status,

                customerEmail:
                    session.customer_details?.email ||
                    session.customer_email ||
                    null

            });

        } catch (error) {

            console.error(
                "Checkout session lookup error:",
                error.message
            );


            res.status(400).json({

                error:
                    "Unable to find checkout session."

            });

        }

    }
);


/* =========================================================
   PROCESS SUCCESSFUL ORDER
========================================================= */

async function processCompletedOrder(
    session
) {

    const metadata =
        session.metadata || {};


    const orderType =
        metadata.orderType ||
        "single";


    const customerEmail =
        metadata.customerEmail ||
        session.customer_details?.email ||
        session.customer_email ||
        "Unknown";


    const displayCurrency =
        metadata.displayCurrency ||
        "USD";


    /* =====================================================
       CART ORDER
    ===================================================== */

    if (
        orderType === "cart"
    ) {

        let orderItems = [];


        try {

            orderItems =
                JSON.parse(
                    metadata.orderItems ||
                    "[]"
                );

        } catch (error) {

            console.error(
                "Could not parse cart order metadata:",
                error.message
            );

        }


        const giftCardTotal =
            metadata.giftCardTotal ||
            "0.00";


        const feeTotal =
            metadata.feeTotal ||
            "0.00";


        const totalUSD =
            metadata.totalUSD ||
            (
                (session.amount_total || 0) /
                100
            ).toFixed(2);


        console.log("");

        console.log(
            "================================"
        );

        console.log(
            "       NEW GIFty CART ORDER"
        );

        console.log(
            "================================"
        );

        console.log(
            "Stripe Session:",
            session.id
        );

        console.log(
            "Customer:",
            customerEmail
        );

        console.log(
            "Items:",
            orderItems.length
        );

        console.log(
            "Gift Cards:",
            giftCardTotal
        );

        console.log(
            "Fees:",
            feeTotal
        );

        console.log(
            "Total USD:",
            totalUSD
        );

        console.log(
            "Currency:",
            displayCurrency
        );


        orderItems.forEach(
            (item, index) => {

                console.log(
                    `${index + 1}.`,
                    item.productName,
                    "$" +
                    Number(
                        item.giftCardValue
                    ).toFixed(2)
                );

            }
        );


        console.log(
            "================================"
        );

        console.log("");


        /* ---------------------------------------------
           EMAIL OWNER
        --------------------------------------------- */

        if (
            resend &&
            process.env.OWNER_EMAIL
        ) {

            const itemsHTML =
                orderItems
                    .map(
                        item => `

                            <tr>

                                <td
                                    style="
                                        padding:10px;
                                        border-bottom:1px solid #eee;
                                    "
                                >
                                    ${escapeHtml(
                                        item.productName
                                    )}
                                </td>

                                <td
                                    style="
                                        padding:10px;
                                        border-bottom:1px solid #eee;
                                    "
                                >
                                    $${Number(
                                        item.giftCardValue
                                    ).toFixed(2)}
                                </td>

                                <td
                                    style="
                                        padding:10px;
                                        border-bottom:1px solid #eee;
                                    "
                                >
                                    $${Number(
                                        item.fee
                                    ).toFixed(2)}
                                </td>

                            </tr>

                        `
                    )
                    .join("");


            await resend.emails.send({

                from:
                    process.env.EMAIL_FROM ||
                    "GIFty <onboarding@resend.dev>",

                to: [
                    process.env.OWNER_EMAIL
                ],

                subject:
                    `🎁 New GIFty Cart Order — ${orderItems.length} items`,

                html: `

                    <div
                        style="
                            font-family:Arial,sans-serif;
                            max-width:700px;
                            margin:auto;
                        "
                    >

                        <h1>
                            🎁 New GIFty Cart Order
                        </h1>

                        <hr>

                        <p>
                            <strong>
                                Customer:
                            </strong>

                            ${escapeHtml(
                                customerEmail
                            )}
                        </p>

                        <p>
                            <strong>
                                Display Currency:
                            </strong>

                            ${escapeHtml(
                                displayCurrency
                            )}
                        </p>

                        <table
                            style="
                                width:100%;
                                border-collapse:collapse;
                                margin-top:20px;
                            "
                        >

                            <thead>

                                <tr>

                                    <th
                                        style="
                                            text-align:left;
                                            padding:10px;
                                        "
                                    >
                                        Gift Card
                                    </th>

                                    <th
                                        style="
                                            text-align:left;
                                            padding:10px;
                                        "
                                    >
                                        Value
                                    </th>

                                    <th
                                        style="
                                            text-align:left;
                                            padding:10px;
                                        "
                                    >
                                        Fee
                                    </th>

                                </tr>

                            </thead>

                            <tbody>

                                ${itemsHTML}

                            </tbody>

                        </table>

                        <hr>

                        <p>
                            <strong>
                                Gift Card Total:
                            </strong>

                            $${escapeHtml(
                                giftCardTotal
                            )}
                        </p>

                        <p>
                            <strong>
                                GIFty Fees:
                            </strong>

                            $${escapeHtml(
                                feeTotal
                            )}
                        </p>

                        <p
                            style="
                                font-size:20px;
                            "
                        >
                            <strong>
                                Total Paid:
                            </strong>

                            $${escapeHtml(
                                totalUSD
                            )}
                        </p>

                        <p>
                            <strong>
                                Stripe Session:
                            </strong>

                            ${escapeHtml(
                                session.id
                            )}
                        </p>

                        <hr>

                        <h2>
                            PAID — PROCESSING
                        </h2>

                        <p>
                            The order has been successfully
                            paid through Stripe.
                        </p>

                    </div>

                `

            });

        }


        /*
         * FUTURE:
         *
         * Purchase each gift card from your supplier
         * and email the codes to customerEmail.
         */


        return;

    }


    /* =====================================================
       SINGLE ORDER
    ===================================================== */

    const product =
        metadata.productName ||
        metadata.productId ||
        "Unknown";


    const giftCardValue =
        metadata.giftCardValue ||
        "0.00";


    const fee =
        metadata.giftyFee ||
        "0.00";


    const totalUSD =
        metadata.totalUSD ||
        (
            (session.amount_total || 0) /
            100
        ).toFixed(2);


    console.log("");

    console.log(
        "================================"
    );

    console.log(
        "        NEW GIFty ORDER"
    );

    console.log(
        "================================"
    );

    console.log(
        "Stripe Session:",
        session.id
    );

    console.log(
        "Product:",
        product
    );

    console.log(
        "Gift Card:",
        giftCardValue
    );

    console.log(
        "Fee:",
        fee
    );

    console.log(
        "Total USD:",
        totalUSD
    );

    console.log(
        "Currency:",
        displayCurrency
    );

    console.log(
        "Customer:",
        customerEmail
    );

    console.log(
        "================================"
    );

    console.log("");


    /* ---------------------------------------------
       EMAIL OWNER
    --------------------------------------------- */

    if (
        resend &&
        process.env.OWNER_EMAIL
    ) {

        await resend.emails.send({

            from:
                process.env.EMAIL_FROM ||
                "GIFty <onboarding@resend.dev>",

            to: [
                process.env.OWNER_EMAIL
            ],

            subject:
                `🎁 New GIFty Order — ${product}`,

            html: `

                <div
                    style="
                        font-family:Arial,sans-serif;
                        max-width:650px;
                        margin:auto;
                    "
                >

                    <h1>
                        🎁 New GIFty Order
                    </h1>

                    <hr>

                    <p>
                        <strong>
                            Product:
                        </strong>

                        ${escapeHtml(
                            product
                        )}
                    </p>

                    <p>
                        <strong>
                            Gift Card:
                        </strong>

                        $${escapeHtml(
                            giftCardValue
                        )}
                    </p>

                    <p>
                        <strong>
                            GIFty Fee:
                        </strong>

                        $${escapeHtml(
                            fee
                        )}
                    </p>

                    <p>
                        <strong>
                            Total Paid:
                        </strong>

                        $${escapeHtml(
                            totalUSD
                        )}
                    </p>

                    <p>
                        <strong>
                            Customer Email:
                        </strong>

                        ${escapeHtml(
                            customerEmail
                        )}
                    </p>

                    <p>
                        <strong>
                            Display Currency:
                        </strong>

                        ${escapeHtml(
                            displayCurrency
                        )}
                    </p>

                    <p>
                        <strong>
                            Stripe Session:
                        </strong>

                        ${escapeHtml(
                            session.id
                        )}
                    </p>

                    <hr>

                    <h2>
                        PAID — PROCESSING
                    </h2>

                    <p>
                        The order has been successfully
                        paid through Stripe.
                    </p>

                </div>

            `

        });

    }


    /*
     * FUTURE:
     *
     * This is where automatic gift-card fulfillment
     * should happen.
     */


}


/* =========================================================
   ESCAPE HTML
========================================================= */

function escapeHtml(value) {

    return String(value)

        .replaceAll(
            "&",
            "&amp;"
        )

        .replaceAll(
            "<",
            "&lt;"
        )

        .replaceAll(
            ">",
            "&gt;"
        )

        .replaceAll(
            '"',
            "&quot;"
        )

        .replaceAll(
            "'",
            "&#039;"
        );

}


/* =========================================================
   404
========================================================= */

app.use(
    (req, res) => {

        res.status(404).json({

            error:
                "Endpoint not found."

        });

    }
);


/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
    (error, req, res, next) => {

        console.error(
            "Server error:",
            error
        );


        res.status(500).json({

            error:
                "Internal server error."

        });

    }
);


/* =========================================================
   START
========================================================= */

app.listen(
    PORT,
    () => {

        console.log("");

        console.log(
            `🎁 GIFty API running on port ${PORT}`
        );

        console.log(
            `Frontend: ${
                FRONTEND_URL ||
                "not configured"
            }`
        );

        console.log("");

    }
);
