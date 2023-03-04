# Remix Auth - Twilio Strategy

Uses the [Twilio Verify API](https://www.twilio.com/verify) to validate users via SMS and add simple phone-based auth to a [Remix](https://remix.run) application using [Remix Auth](https://github.com/sergiodxa/remix-auth).

This library is designed to require as little config as possible. There's no need to generate your own codes, validate input, or store anything aside from the user's phone number in your database. If you need more advanced functionality and customizations, check out [remix-auth-otp](https://github.com/dev-xo/remix-auth-otp).

## Usage

### Create a Twilio account

Create a [Twilio](https://www.twilio.com) account, then go to the Verify tab in the dashboard and create a new service. You'll need three keys from the Twilio dashboard: an **Account SID**, an **Auth Token**, and a **Service SID**.

### Create the strategy instance

```ts
// app/session.server.ts
import { createCookieSessionStorage } from "@remix-run/node";

export const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "_rmx-session", // use any name you want here
    sameSite: "lax", // this helps with CSRF
    path: "/", // remember to add this so the cookie will work in all routes
    httpOnly: true, // for security reasons, make this cookie http only
    secrets: ["s3cr3t"], // replace this with an actual secret
    secure: process.env.NODE_ENV === "production", // enable this in prod only
  },
});
```

```ts
// app/auth.server.ts
import { TwilioStrategy } from "remix-auth-twilio";
import { sessionStorage } from "./session.server";
import { User, findOrCreateUser } from "your-db-client";

export let authenticator = new Authenticator<User>(sessionStorage);

const twilioStrategy = new TwilioStrategy(
  {
    accountSID: "YOUR_ACCOUNT_SID",
    authToken: "YOUR_AUTH_TOKEN",
    serviceSID: "YOUR_SERVICE_SID",
  },
  async ({ phone, formData, request }) => {
    // The user has been authenticated through Twilio.
    // Get the user data from your DB or API using the formatted phone number.
    return findOrCreateUser({ phone });
  }
);

authenticator.use(twilioStrategy);
```

### Set up your routes

```tsx
// app/routes/login.tsx
import { ActionArgs, DataFunctionArgs, json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { authenticator } from "../auth.server";
import { sessionStorage } from "../session.server";

export async function action({ request }: ActionArgs) {
  const formData = await request.clone().formData();

  return authenticator.authenticate("twilio", request, {
    successRedirect: formData.has("code") ? "/account" : "/login",
    failureRedirect: "/login",
  });
}

export async function loader({ request }: DataFunctionArgs) {
  await authenticator.isAuthenticated(request, {
    successRedirect: "/account",
  });

  const session = await sessionStorage.getSession(
    request.headers.get("Cookie")
  );

  const phone = session.get("twilio:phone") ?? null;

  const error = session.get(authenticator.sessionErrorKey);

  return json(
    { phone, error },
    {
      headers: {
        "Set-Cookie": await sessionStorage.commitSession(session),
      },
    }
  );
}

export default function LoginPage() {
  const { phone, error } = useLoaderData<typeof loader>();

  return (
    <form method="post">
      {error && <p>Error: {error.message}</p>}
      {phone ? (
        <>
          <label htmlFor="code">Verification code</label>
          <input
            type="text"
            name="code"
            id="code"
            autoFocus
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9]*"
          />
          <input type="hidden" name="phone" value={phone} />
        </>
      ) : (
        <>
          <label htmlFor="phone">Phone number</label>
          <input type="tel" name="phone" id="phone" autoComplete="tel" />
        </>
      )}
    </form>
  );
}
```

```tsx
// app/routes/account.tsx
import { DataFunctionArgs, json } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import { authenticator } from "~/auth.server";

export async function loader({ request }: DataFunctionArgs) {
  const user = await authenticator.isAuthenticated(request, {
    failureRedirect: "/login",
  });

  return json({ user });
}

export default function AccountPage() {
  const { user } = useLoaderData<typeof loader>();

  return (
    <div>
      <p>Hello, {user.phone}</p>
      <p>
        <Link to="/logout">Log out</Link>
      </p>
    </div>
  );
}
```

```tsx
// app/routes/logout.tsx
import { DataFunctionArgs } from "@remix-run/node";
import { authenticator } from "~/auth.server";

export async function loader({ request }: DataFunctionArgs) {
  await authenticator.logout(request, { redirectTo: "/login" });
}

export default function LogoutPage() {
  return null;
}
```

## Options

```ts
type TwilioStrategyOptions = {
  /**
   * Twilio Account SID
   */
  accountSID?: string;
  /**
   * Twilio Auth Token
   */
  authToken?: string;
  /**
   * Twilio Verify Service SID
   */
  serviceSID?: string;
  /**
   * A function that sends a verification code to the user.
   */
  sendCode?: ({ phone }: { phone: string }) => Promise<void>;
  /**
   * A function that validates the verification code provided by the user.
   */
  validateCode?: ({
    code,
    phone,
  }: {
    code: string;
    phone: string;
  }) => Promise<void>;
  /**
   * A function that formats the phone number provided by the user.
   * This library uses the `phone` package to validate phone numbers.
   * You can optionally provide your own validation function here.
   */
  formatPhoneNumber?: (phone: string) => string;
};
```
