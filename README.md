# Dagpay example

**Minimal [Dagpay](https://dagpay.io) integration example written in JavaScript.**

This project shows how to integrate with the Dagpay payment API. You can host this example yourself or use it as a reference and play around with it at [https://example.dagpay.io/](https://example.dagpay.io/).

Also reference the [official documentation](https://dagpay.io/public/documentation).

## Running the example

While you can run this example on your local computer, the server-to-server status reporting won't work as Dagpay servers have no way of contacting your private pc. Thus to get it fully working, you need to run it on a real server and use https (as status URL is required to use SSL).

1. Create Dagpay account, wallet, environment (as per documentation referenced above).
2. Clone the repository to your web server.
3. Make sure you can serve https content (use letsencrypt etc).
4. Create a `.env` file in the project root with contents like referenced below.
5. Start the server.

You should now be able to create invoices and pay them using the [Testnet Dag](https://play.google.com/store/apps/details?id=org.dagcoin.testnet&hl=en) app.

### Configuration .env file contents example

```
SERVER_PORT=443
SERVER_USE_SSL=true
SERVER_CERT=/etc/letsencrypt/live/example.com/fullchain.pem
SERVER_KEY=/etc/letsencrypt/live/example.com/privkey.pem

DAGPAY_API_BASE_URL=https://test-api.dagpay.io/api
DAGPAY_USER_ID=1306d6b4-7a5b-4dab-b4ee-9803f148d194
DAGPAY_ENVIRONMENT_ID=2ede58fe-d6df-4841-b909-37622390405a
DAGPAY_SECRET=384F2DE967EC642CA0A686FC4A9C1EA9
```