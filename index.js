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
  environments: [
    {
      name: "Live",
      apiBaseUrl: process.env.ENV_LIVE_API_BASE_URL,
      userId: process.env.ENV_LIVE_USER_ID,
      environmentId: process.env.ENV_LIVE_ENVIRONMENT_ID,
      secret: process.env.ENV_LIVE_SECRET
    },
    {
      name: "Test",
      apiBaseUrl: process.env.ENV_TEST_API_BASE_URL,
      userId: process.env.ENV_TEST_USER_ID,
      environmentId: process.env.ENV_TEST_ENVIRONMENT_ID,
      secret: process.env.ENV_TEST_SECRET
    },
    {
      name: "Development",
      apiBaseUrl: process.env.ENV_DEV_API_BASE_URL,
      userId: process.env.ENV_DEV_USER_ID,
      environmentId: process.env.ENV_DEV_ENVIRONMENT_ID,
      secret: process.env.ENV_DEV_SECRET
    }
  ]
};

// create the express server application
const app = express();

// represents invoice "database" where the key is the invoice id and value is invoice info
const invoices = {};

// enable session support
app.use(
  session({
    secret: "ASDFS2342JGAJ342DE2SAAL52HASM34J",
    resave: false,
    saveUninitialized: true
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
        <label>
          Amount<br/>
          <input name="currencyAmount" value="0.1"/>
        </label>
      </p>
      <p>
        <label>
          Currency<br/>
          <select name="currency">
            <option value="DAG">DAG</option>
            <option value="BTC">BTC</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </label>
      </p>
      <p>
        <label>
          Description<br/>
          <input name="description" value="iPhone X"/>
        </label>
      </p>
      <p>
        <label>
          Environment<br/>
          <select name="environment">
            ${config.environments
              .filter(
                env => typeof env.userId === "string" && env.userId.length > 0
              )
              .map(
                env =>
                  `<option value="${env.name}"${
                    env.name === "Test" ? " selected" : ""
                  }>${env.name} - ${env.apiBaseUrl}</option>`
              )
              .join("\n")}
          </select>
        </label>
      </p>
      <p>
        <input type="submit" value="Pay with Dagcoin"/>
      </p>
    </form>

    <p>
      Github: <a href="https://github.com/dagpay/dagpay-example" target="_blank">https://github.com/dagpay/dagpay-example</a>
    </p>
    <p>
      Documentation: <a href="https://app.dagpay.io/documentation" target="_blank">https://app.dagpay.io/documentation</a>
    </p>
  `);
});

// handle the "Pay with dagcoin" form POST request
app.post("/buy", async (request, response, next) => {
  // extract form info
  const { currencyAmount, currency, description, environment } = request.body;

  // find environment configuration by name
  const environmentConfig = config.environments.find(
    env => env.name === environment
  );

  // make sure the environment configuration exists
  if (!environmentConfig) {
    next(new Error(`Invalid environment "${environment}" requested`));

    return;
  }

  // build the invoice signature info
  const invoiceSignatureInfo = {
    userId: environmentConfig.userId,
    environmentId: environmentConfig.environmentId,
    currencyAmount: parseFloat(currencyAmount), // we're using a simple form so always getting strings
    currency,
    description,
    data: JSON.stringify({ environment }), // you can include arbitrary data such as session id etc
    paymentId: getRandomString(32), // usually internal payment database entry id
    date: new Date().toISOString(),
    nonce: getRandomString(32)
  };

  // calculate the create invoice signature
  const signature = getCreateInvoiceSignature(
    invoiceSignatureInfo,
    environmentConfig.secret
  );

  // add the signature to build the create invoice info
  const createInvoiceRequestInfo = {
    ...invoiceSignatureInfo,
    signature
  };

  // build create invoice API url
  const url = `${environmentConfig.apiBaseUrl}/invoices`;

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
    request.session.environment = environment;

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
  // get provided info and extract environment name from the attached data
  const invoice = request.body;
  const environment = JSON.parse(invoice.data).environment;

  // find environment configuration by name
  const environmentConfig = config.environments.find(
    env => env.name === environment
  );

  // calculate the expected signature
  const providedSignature = invoice.signature;
  const expectedSignature = getInvoiceInfoSignature(
    invoice,
    environmentConfig.secret
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
