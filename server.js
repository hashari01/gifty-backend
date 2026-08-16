require("dotenv").config();

const express = require("express");
const cors = require("cors");
const Stripe = require("stripe");

const app = express();

const stripe = Stripe(
    process.env.STRIPE_SECRET_KEY
);

app.use(cors({
    origin: process.env.FRONTEND_URL
}));

app.use(express.json());


app.get("/", (req, res) => {
    res.json({
        service: "GIFty API",
        status: "online"
    });
});


app.post("/create-checkout-session", async (req, res) => {

    try {

        const {
            productId,
            amount,
            email
        } = req.body;

        const products = {

            steam: {
                name: "Steam",
                amounts: [5, 10, 20, 50, 100],
                fee: 1.49
            },

            spotify: {
                name: "Spotify",
                amounts: [10, 20, 30, 50],
                fee: 1.49
            },

            roblox: {
                name: "Roblox",
                amounts: [10, 20, 25, 50, 100],
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

            netflix: {
                name: "Netflix",
                amounts: [15, 25, 50, 100],
                fee: 1.99
            }
        };


        const product = products[productId];

        if (!product) {
            return res.status(400).json({
                error: "Invalid product."
            });
        }


        const numericAmount = Number(amount);

        if (!product.amounts.includes(numericAmount)) {
            return res.status(400).json({
                error: "Invalid gift card amount."
            });
        }


        if (
            typeof email !== "string" ||
            !email.includes("@")
        ) {
            return res.status(400).json({
                error: "Invalid email."
            });
        }


        const total =
            numericAmount + product.fee;


        const session =
            await stripe.checkout.sessions.create({

                mode: "payment",

                customer_email: email,

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
                                Math.round(total * 100)
                        },

                        quantity: 1
                    }

                ],

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

                success_url:
                    `${process.env.FRONTEND_URL}/?payment=success`,

                cancel_url:
                    `${process.env.FRONTEND_URL}/?payment=cancelled`
            });


        res.json({
            url: session.url
        });


    } catch (error) {

        console.error(error);

        res.status(500).json({
            error: "Unable to create checkout."
        });

    }

});


const PORT =
    process.env.PORT || 3000;


app.listen(PORT, () => {

    console.log(
        `GIFty API running on port ${PORT}`
    );

});
