const axios = require("axios");
const express = require("express");
const bodyParser = require("body-parser");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const fs = require("fs");

// load the .env configuration (https://github.com/motdotla/dotenv)
require("dotenv").config();

// build the configuration from .env file
const config = {
  server: {
    port: process.env.SERVER_PORT,
    useSSL: process.env.SERVER_USE_SSL === "true",
    cert: process.env.SERVER_CERT,
    key: process.env.SERVER_KEY
  },
  dagpay: {
    apiBaseUrl: process.env.DAGPAY_API_BASE_URL,
    userId: process.env.DAGPAY_USER_ID,
    environmentId: process.env.DAGPAY_ENVIRONMENT_ID,
    secret: process.env.DAGPAY_SECRET
  }
};

// create the express server application
const app = express();

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// parse application/json
app.use(bodyParser.json());

// handle index request
app.get("/", (request, response, next) => {
  response.send(`
    <h1>Example Dagpay merchant application</h1>

    <h2>Configuration</h2>
    <ul>
      <li><strong>Api base url: </strong> ${config.dagpay.apiBaseUrl}</li>
      <li><strong>User id: </strong> ${config.dagpay.userId}</li>
      <li><strong>Environment id: </strong> ${config.dagpay.environmentId}</li>
      <li><strong>Secret: </strong> ${config.dagpay.secret}</li>
    </ul>

    <h2>Shop</h2>
    <form action="/buy" method="post"
      <p>
        <label><input name="currencyAmount" value="0.1"/> Amount</label>
      </p>
      <p>
        <label><input name="description" value="iPhone X"/> Description</label>
      </p>
      <p>
        <input type="submit" value="Pay with Dagcoin"/>
      </p>
    </form>
  `);
});

// handle the "Pay with dagcoin" form POST request
app.post("/buy", async (request, response, next) => {
  // extract form info
  const { currencyAmount, description } = request.body;

  // build the invoice signature info
  const invoiceSignatureInfo = {
    userId: config.dagpay.userId,
    environmentId: config.dagpay.environmentId,
    currencyAmount: parseFloat(currencyAmount),
    currency: "DAG",
    description,
    data: '{"sessionId": "foobar"}',
    paymentId: "foobar",
    date: new Date().toISOString(),
    nonce: getRandomString(32)
  };

  // calculate the create invoice signature
  const signature = getCreateInvoiceSignature(
    invoiceSignatureInfo,
    config.dagpay.secret
  );

  // add the signature to invoice info
  const createInvoiceRequestInfo = {
    ...invoiceSignatureInfo,
    signature
  };

  // build create invoice API url
  const url = `${config.dagpay.apiBaseUrl}/invoices`;

  // attempt to create the invoice
  try {
    // post to create invoice (throws on failure)
    const result = await axios.post(url, createInvoiceRequestInfo);
    const invoice = result.data.payload;

    // show invoice info in the console
    console.log("invoice", invoice);

    // redirect the user to invoice.paymentUrl
    response.redirect(invoice.paymentUrl);
  } catch (e) {
    response.status(500).send({
      message: e.message,
      status: e.response.status,
      data: e.response.data
    });
  }
});

// handle the dagpay status server-to-server request (you can't test this on localhost)
app.post("/status", (request, response, next) => {
  // get provided info and calculate the expected signature
  const invoice = request.body;
  const providedSignature = invoice.signature;
  const expectedSignature = getInvoiceInfoSignature(
    invoice,
    config.dagpay.secret
  );

  // expect provided signature to match expected signature
  if (providedSignature !== expectedSignature) {
    // log details
    console.error({
      invoice,
      providedSignature,
      expectedSignature
    });

    // send error response
    response.status(500).send("Invalid signature provided");

    return;
  }

  // handle valid invoice update info
  console.log("got valid status update", invoice);
});

// create either http or https server depending on SSL configuration
const server = config.server.useSSL
  ? https.createServer(
      {
        cert: fs.readFileSync(config.server.cert),
        key: fs.readFileSync(config.server.key)
      },
      app
    )
  : http.createServer(app);

// start the server
server.listen(config.server.port, () => {
  console.log(`server started on port ${config.server.port}`);
});

// returns signature for creating an invoice
function getCreateInvoiceSignature(info, secret) {
  const separator = ":";
  const tokens = [
    info.currencyAmount,
    info.currency,
    info.description,
    info.data,
    info.userId,
    info.paymentId,
    info.date,
    info.nonce
  ];

  return getSignature(tokens, secret, separator);
}

// return signature for invoice info
function getInvoiceInfoSignature(info, secret) {
  const separator = ":";
  const tokens = [
    info.id,
    info.userId,
    info.environmentId,
    info.coinAmount,
    info.currencyAmount,
    info.currency,
    info.description,
    info.data,
    info.paymentId,
    info.qrCodeUrl,
    info.paymentUrl,
    info.state,
    info.createdDate,
    info.updatedDate,
    info.expiryDate,
    info.validForSeconds,
    info.statusDelivered ? "true" : "false",
    info.statusDeliveryAttempts,
    info.statusLastAttemptDate !== null ? info.statusLastAttemptDate : "",
    info.statusDeliveredDate !== null ? info.statusDeliveredDate : "",
    info.date,
    info.nonce
  ];

  return getSignature(tokens, secret, separator);
}

// calculates the hmac signature
function getSignature(tokens, key, separator) {
  const payload = tokens.join(separator);

  return crypto
    .createHmac("sha512", key)
    .update(payload)
    .digest("hex");
}

// return a random string of requested length
function getRandomString(length) {
  return crypto
    .randomBytes(Math.ceil(length / 2))
    .toString("hex")
    .slice(0, length)
    .toUpperCase();
}
