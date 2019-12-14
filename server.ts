import * as Boom from "boom";
import * as Hapi from "hapi";

import { useAuthFacebook, useAuthGitHub, useAuthGoogle } from "./sso-strategy";

// Connect to database
import connectMongodb from "./db-mongo";
import connectMysql from "./db-mysql";

export default async function createServer(serverOptions, options) {
  // Hapi server
  const server = new Hapi.Server(
    Object.assign(
      {
        port: 3000,
        host: "localhost",
        routes: {
          validate: {
            failAction: async (request, h, err) => {
              if (process.env.NODE_ENV === "production") {
                // In prod, log a limited error message and throw the default Bad Request error.
                console.error("ValidationError:", err.message);
                throw Boom.badRequest(`Invalid request payload input`);
              } else {
                // During development, log and respond with the full error.
                console.error(err);
                throw err;
              }
            }
          },
          cors: {
            origin: ["*"]
          }
        }
      },
      serverOptions
    )
  );

  server.app = {
    // Mongodb connect
    mongooseContext: await connectMongodb(),
    // Mysql connect
    sequelizeContext: await connectMysql()
  };

  // Redirect to SSL
  if (options.enableSSL) {
    console.log("Settings API: SSL enabled;");
    await server.register({ plugin: require("hapi-require-https") });
  } else {
    console.log("Settings API: SSL disabled;");
  }

  // SSO
  if (options.enableSSO) {
    console.log("Settings API: SSO enabled;");
    await server.register(require("bell"));
    await useAuthGitHub(server, options.ssoCallback);
    await useAuthFacebook(server, options.ssoCallback);
    await useAuthGoogle(server, options.ssoCallback);
  } else {
    console.log("Settings API: SSO disabled;");
  }

  // Hapi JWT auth
  await server.register(require("hapi-auth-jwt2"));
  server.auth.strategy("jwt", "jwt", {
    key: process.env.JWT_SECRET,
    validate: validateFunc,
    verifyOptions: { algorithms: ["HS256"] }
  });
  server.auth.default("jwt");

  // Hapi plugins
  await server.register([
    require("vision"),
    require("inert"),
    {
      plugin: require("hapi-swagger"),
      options: options.swaggerOptions
    },
    {
      plugin: require("hapi-routes"),
      options: {
        dir: `${__dirname}/../routes/**`,
        prefix: "/api",
        routes: {
          prefix: "/api"
        }
      }
    },
    {
      plugin: require("good"),
      options: {
        ops: {
          interval: 1000
        },
        reporters: {
          consoleReporter: [
            {
              module: "good-squeeze",
              name: "Squeeze",
              args: [{ response: "*" }]
            },
            {
              module: "good-console"
            },
            "stdout"
          ]
        }
      }
    }
  ]);

  return server;
}

const validateFunc = async decoded => {
  return {
    isValid: true,
    credentials: decoded
  };
};