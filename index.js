const axios = require("axios");
const express = require("express");
const session = require("express-session");
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

// represents invoice "database" where the key is the invoice id and value is invoice info
const invoices = {};

// enable session support
app.use(
  session({
    secret: "ASDFS2342JGAJ342DE2SAAL52HASM34J"
  })
);

// parse application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: false }));

// parse application/json
app.use(bodyParser.json());

// handle index request
app.get("/", (request, response, next) => {
  response.send(`
    <h1>Example Dagpay application</h1>

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

    <p>
      Github: <a href="https://github.com/dagcoin/dagpay-example" target="_blank">https://github.com/dagcoin/dagpay-example</a>
    </p>
    <p>
      Documentation: <a href="https://dagpay.io/public/documentation" target="_blank">https://dagpay.io/public/documentation</a>
    </p>
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
    data: JSON.stringify({ sessionId: request.session.id }),
    paymentId: "foobar",
    date: new Date().toISOString(),
    nonce: getRandomString(32)
  };

  // calculate the create invoice signature
  const signature = getCreateInvoiceSignature(
    invoiceSignatureInfo,
    config.dagpay.secret
  );

  // add the signature to build the create invoice info
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
    console.log("created invoice", invoice);

    // "save" the invoice so we can get it by id later (you'd normally use a database)
    invoices[invoice.id] = invoice;

    // store the last created invoice id in user session so we know which one we're working with
    request.session.invoiceId = invoice.id;

    // redirect the user to payment view
    response.redirect(invoice.paymentUrl);
  } catch (e) {
    // show error view (you'll get here when trying to make an invoice with negative amount etc)
    response.status(403).send(`
      <h1>Example Dagpay application</h1>

      <h2>Creating invoice failed [${e.response.status}]</h2>
      <p>
        <strong>${e.message}</strong>
      </p>
      <p>
        <pre>${JSON.stringify(e.response.data, undefined, "  ")}</pre>
      </p>
    `);
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

  // log valid invoice update info
  console.log("got valid invoice status update", invoice);

  // "update" the invoice info
  invoices[invoice.id] = invoice;

  // send success response
  response.send("OK");
});

// handle the result redirect
app.get("/result", (request, response, next) => {
  // get the created invoice id from the session
  const invoiceId = request.session.invoiceId;

  // show a message if there's no invoice id available
  if (!invoiceId) {
    response.status(404).send("No invoice has been created");

    return;
  }

  // get the invoice info
  const invoice = invoices[invoiceId];

  // show the invoice info
  response.send(`
    <h1>Example Dagpay application</h1>

    <h2>Invoice result</h2>
    <p>
      <strong>Amount:</strong> ${invoice.currencyAmount} ${invoice.currency}
      (${invoice.coinAmount} DAG)
    </p>
    <p>
      <strong>Description:</strong> ${invoice.description}
    </p>
    <p>
      <strong>State:</strong> ${invoice.state}
    </p>
    <p>
      <pre>${JSON.stringify(invoice, undefined, "  ")}</pre>
    </p>
    <p>
      <a href="/">Back to index</a>
    </p>
  `);
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

// also start a http server to redirect to https if ssl is enabled
if (config.server.useSSL) {
  express()
    .use((request, response, _next) => {
      response.redirect(`https://${request.hostname}${request.originalUrl}`);
    })
    .listen(80);
}

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
