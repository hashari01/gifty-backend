require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");
const { Resend } = require("resend");

const app = express();

const PORT = process.env.PORT || 3000;
const FRONTEND_URL =
    process.env.FRONTEND_URL || "https://hashari01.github.io";

if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("Missing STRIPE_SECRET_KEY");
}

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

const resend = process.env.RESEND_API_KEY
    ? new Resend(process.env.RESEND_API_KEY)
    : null;


/* =========================================================
   CORS
========================================================= */

app.disable("x-powered-by");

app.use(
    cors({
        origin: FRONTEND_URL,
        methods: ["GET", "POST"],
        allowedHeaders: ["Content-Type"]
    })
);


/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/", (req, res) => {
    res.json({
        service: "GIFty API",
        status: "online",
        version: "4.0.0"
    });
});


/* =========================================================
   STRIPE WEBHOOK
   IMPORTANT:
   This MUST be before express.json()
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
                return res
                    .status(400)
                    .send("Missing Stripe signature.");
            }

            if (!process.env.STRIPE_WEBHOOK_SECRET) {
                return res
                    .status(500)
                    .send("Webhook secret not configured.");
            }

            event =
                stripe.webhooks.constructEvent(
                    req.body,
                    signature,
                    process.env.STRIPE_WEBHOOK_SECRET
                );

        } catch (error) {

            console.error(
                "Webhook verification failed:",
                error.message
            );

            return res
                .status(400)
                .send("Webhook Error");
        }


        try {

            switch (event.type) {

                case "checkout.session.completed":

                    await processCompletedOrder(
                        event.data.object
                    );

                    break;


                case "checkout.session.async_payment_succeeded":

                    await processCompletedOrder(
                        event.data.object
                    );

                    break;


                default:

                    console.log(
                        `Unhandled Stripe event: ${event.type}`
                    );
            }


            res.json({
                received: true
            });

        } catch (error) {

            console.error(
                "Webhook processing error:",
                error
            );

            res
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
   EXCHANGE RATES
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


async function getExchangeRates() {

    const now = Date.now();

    if (
        exchangeRateCache.timestamp &&
        now - exchangeRateCache.timestamp <
            RATE_CACHE_TIME
    ) {
        return exchangeRateCache;
    }

    const response = await fetch(
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
        timestamp: now
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
                rates: data.rates,
                date: data.date,
                currencies:
                    SUPPORTED_CURRENCIES
            });

        } catch (error) {

            console.error(
                "Exchange rate error:",
                error.message
            );

            res
                .status(503)
                .json({
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
   PRODUCTS ENDPOINT
========================================================= */

app.get(
    "/products",
    (req, res) => {

        const publicProducts =
            Object.entries(products).map(
                ([id, product]) => ({
                    id,
                    name: product.name,
                    amounts: product.amounts
                })
            );

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
   DISPLAY CURRENCY
========================================================= */

function getDisplayCurrency(
    displayCurrency
) {

    if (
        typeof displayCurrency === "string"
    ) {

        const currency =
            displayCurrency.toUpperCase();

        if (
            SUPPORTED_CURRENCIES[currency]
        ) {
            return currency;
        }
    }

    return "USD";
}


/* =========================================================
   SINGLE CHECKOUT
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

            const product =
                products[productId];

            if (!product) {
                return res
                    .status(400)
                    .json({
                        error:
                            "Invalid product."
                    });
            }

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
                return res
                    .status(400)
                    .json({
                        error:
                            "Invalid gift card amount."
                    });
            }

            if (!isValidEmail(email)) {
                return res
                    .status(400)
                    .json({
                        error:
                            "Please provide a valid email address."
                    });
            }

            const customerEmail =
                email.trim();

            const currency =
                getDisplayCurrency(
                    displayCurrency
                );

            const total =
                numericAmount +
                product.fee;

            const session =
                await stripe.checkout.sessions.create({

                    mode: "payment",

                    customer_email:
                        customerEmail,

                    /*
                     * THIS IS THE IMPORTANT PART.
                     *
                     * Stripe sends the payment
                     * receipt to the customer.
                     */
                    payment_intent_data: {
                        receipt_email:
                            customerEmail
                    },

                    line_items: [
                        {
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

                        customerEmail,

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
                url: session.url,
                sessionId: session.id
            });

        } catch (error) {

            console.error(
                "Single checkout error:",
                error
            );

            return res
                .status(500)
                .json({
                    error:
                        "Unable to create secure checkout."
                });
        }
    }
);


/* =========================================================
   CART CHECKOUT
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

            if (
                !Array.isArray(items) ||
                items.length === 0
            ) {
                return res
                    .status(400)
                    .json({
                        error:
                            "Your cart is empty."
                    });
            }

            if (items.length > 50) {
                return res
                    .status(400)
                    .json({
                        error:
                            "Too many items in cart."
                    });
            }

            if (!isValidEmail(email)) {
                return res
                    .status(400)
                    .json({
                        error:
                            "Please provide a valid email address."
                    });
            }

            const customerEmail =
                email.trim();

            const currency =
                getDisplayCurrency(
                    displayCurrency
                );

            const lineItems = [];
            const orderItems = [];

            let orderTotal = 0;


            for (const item of items) {

                /*
                 * Accept both product and productId.
                 */
                const productId =
                    item.product ||
                    item.productId;

                const product =
                    products[productId];

                if (!product) {
                    return res
                        .status(400)
                        .json({
                            error:
                                `Invalid product: ${productId}`
                        });
                }

                const amount =
                    Number(item.amount);

                if (
                    !Number.isFinite(amount) ||
                    !product.amounts.includes(
                        amount
                    )
                ) {
                    return res
                        .status(400)
                        .json({
                            error:
                                `Invalid amount for ${product.name}.`
                        });
                }

                const quantity =
                    Math.max(
                        1,
                        Number(
                            item.quantity || 1
                        )
                    );

                const fee =
                    Number(product.fee);

                const itemTotal =
                    amount + fee;

                orderTotal +=
                    itemTotal * quantity;


                lineItems.push({

                    price_data: {

                        currency: "usd",

                        product_data: {

                            name:
                                `${product.name} Gift Card`,

                            description:
                                `GIFty ${product.name} digital gift card + $${fee.toFixed(2)} service fee`
                        },

                        unit_amount:
                            Math.round(
                                itemTotal * 100
                            )
                    },

                    quantity
                });


                orderItems.push({

                    productId,

                    productName:
                        product.name,

                    giftCardValue:
                        amount.toFixed(2),

                    fee:
                        fee.toFixed(2),

                    quantity,

                    total:
                        (
                            itemTotal *
                            quantity
                        ).toFixed(2)
                });
            }


            const session =
                await stripe.checkout.sessions.create({

                    mode: "payment",

                    customer_email:
                        customerEmail,

                    /*
                     * THIS IS THE IMPORTANT PART.
                     *
                     * Stripe sends the customer
                     * a payment receipt.
                     */
                    payment_intent_data: {

                        receipt_email:
                            customerEmail
                    },

                    line_items:
                        lineItems,

                    metadata: {

                        orderType:
                            "cart",

                        customerEmail,

                        displayCurrency:
                            currency,

                        itemCount:
                            String(
                                orderItems.length
                            ),

                        totalUSD:
                            orderTotal.toFixed(2),

                        items:
                            JSON.stringify(
                                orderItems
                            )
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


            console.log("");
            console.log(
                "================================"
            );
            console.log(
                "      CART CHECKOUT CREATED"
            );
            console.log(
                "================================"
            );
            console.log(
                "Session:",
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
                "Total:",
                orderTotal.toFixed(2)
            );
            console.log(
                "================================"
            );


            return res.json({

                success: true,

                url:
                    session.url,

                sessionId:
                    session.id
            });


        } catch (error) {

            console.error(
                "Cart checkout error:",
                error
            );

            return res
                .status(500)
                .json({
                    error:
                        "Unable to create cart checkout."
                });
        }
    }
);


/* =========================================================
   PROCESS COMPLETED ORDER
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
        "Unknown";

    const displayCurrency =
        metadata.displayCurrency ||
        "USD";

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
        "Order Type:",
        orderType
    );
    console.log(
        "Customer:",
        customerEmail
    );
    console.log(
        "Display Currency:",
        displayCurrency
    );
    console.log(
        "Total USD:",
        totalUSD
    );


    let orderHtml = "";


    if (orderType === "cart") {

        let items = [];

        try {
            items =
                JSON.parse(
                    metadata.items || "[]"
                );
        } catch {
            items = [];
        }


        console.log(
            "Cart Items:",
            items.length
        );


        orderHtml =
            items.map(
                item => {

                    console.log(
                        `${item.productName} - $${item.giftCardValue}`
                    );

                    return `
                        <div style="
                            padding:12px;
                            margin:10px 0;
                            background:#f5f5f5;
                            border-radius:8px;
                        ">
                            <strong>
                                ${escapeHtml(
                                    item.productName
                                )}
                            </strong>

                            <br>

                            Gift Card:
                            $${escapeHtml(
                                item.giftCardValue
                            )}

                            <br>

                            Fee:
                            $${escapeHtml(
                                item.fee
                            )}

                            <br>

                            Quantity:
                            ${escapeHtml(
                                item.quantity || 1
                            )}

                            <br>

                            Total:
                            $${escapeHtml(
                                item.total
                            )}
                        </div>
                    `;
                }
            ).join("");

    } else {

        console.log(
            "Product:",
            metadata.productName
        );

        console.log(
            "Gift Card:",
            metadata.giftCardValue
        );

        console.log(
            "Fee:",
            metadata.giftyFee
        );


        orderHtml = `

            <p>
                <strong>Product:</strong>
                ${escapeHtml(
                    metadata.productName ||
                    metadata.productId ||
                    "Unknown"
                )}
            </p>

            <p>
                <strong>Gift Card:</strong>
                $${escapeHtml(
                    metadata.giftCardValue ||
                    "0.00"
                )}
            </p>

            <p>
                <strong>GIFty Fee:</strong>
                $${escapeHtml(
                    metadata.giftyFee ||
                    "0.00"
                )}
            </p>
        `;
    }


    console.log(
        "================================"
    );


    /* =====================================================
       EMAIL OWNER
    ===================================================== */

    if (
        resend &&
        process.env.OWNER_EMAIL
    ) {

        try {

            await resend.emails.send({

                from:
                    process.env.EMAIL_FROM ||
                    "GIFty <onboarding@resend.dev>",

                to: [
                    process.env.OWNER_EMAIL
                ],

                subject:
                    `🎁 New GIFty Order — $${totalUSD}`,

                html: `

                    <div style="
                        font-family:Arial,sans-serif;
                        max-width:650px;
                        margin:auto;
                    ">

                        <h1>
                            🎁 New GIFty Order
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
                                Order Type:
                            </strong>

                            ${escapeHtml(
                                orderType
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

                        ${orderHtml}

                        <hr>

                        <h2>
                            Total Paid:
                            $${escapeHtml(
                                totalUSD
                            )}
                        </h2>

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
                            ✅ PAID
                        </h2>

                    </div>
                `
            });

            console.log(
                "Owner order email sent."
            );

        } catch (error) {

            console.error(
                "Owner email failed:",
                error
            );
        }
    }


    /*
     * IMPORTANT:
     *
     * The CUSTOMER receipt is handled by Stripe
     * through payment_intent_data.receipt_email.
     *
     * The owner notification above is handled
     * by Resend.
     *
     * So the customer gets their payment receipt
     * and you still get your new-order email.
     */
}


/* =========================================================
   HTML ESCAPE
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

        res
            .status(404)
            .json({
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

        res
            .status(500)
            .json({
                error:
                    "Internal server error."
            });
    }
);


/* =========================================================
   START SERVER
========================================================= */

app.listen(
    PORT,
    () => {

        console.log(
            `🎁 GIFty API running on port ${PORT}`
        );

        console.log(
            `Frontend: ${FRONTEND_URL}`
        );
    }
);
