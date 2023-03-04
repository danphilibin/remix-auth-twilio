import { SessionStorage, redirect } from "@remix-run/server-runtime";
import phone from "phone";
import {
  AuthenticateOptions,
  Strategy,
  StrategyVerifyCallback,
} from "remix-auth";
import twilio from "twilio";
import Twilio from "twilio/lib/rest/Twilio";
import { VerificationInstance } from "twilio/lib/rest/verify/v2/service/verification";
import { VerificationCheckInstance } from "twilio/lib/rest/verify/v2/service/verificationCheck";

type SendCodeFunction = ({
  phone,
}: {
  phone: string;
}) => Promise<VerificationInstance>;

type ValidateCodeFunction = ({
  code,
  phone,
}: {
  code: string;
  phone: string;
}) => Promise<VerificationCheckInstance>;

type FormatPhoneNumberFunction = (phone: string) => string;

export type TwilioStrategyOptions = {
  /**
   * Twilio Account SID
   */
  accountSID: string;
  /**
   * Twilio Auth Token
   */
  authToken: string;
  /**
   * Twilio Verify Service SID
   */
  serviceSID: string;
  /**
   * A function that sends a verification code to the user.
   */
  sendCode?: SendCodeFunction;
  /**
   * A function that validates the verification code provided by the user.
   */
  validateCode?: ValidateCodeFunction;
  /**
   * A function that formats the phone number provided by the user.
   * This library uses the `phone` package to validate phone numbers.
   * You can optionally provide your own validation function here.
   */
  formatPhoneNumber?: FormatPhoneNumberFunction;
};

export interface TwilioStrategyParams {
  /**
   * The phone number provided by the user.
   */
  phone: string;
  /**
   * A FormData object that contains the form
   * used to trigger the authentication.
   */
  formData: FormData;
  /**
   * The Request object.
   */
  request: Request;
}

export class TwilioStrategy<User> extends Strategy<User, TwilioStrategyParams> {
  name = "twilio";

  private readonly sessionPhoneKey: string;
  private readonly client: Twilio;
  private readonly options: TwilioStrategyOptions;
  private readonly sendCode: SendCodeFunction;
  private readonly validateCode: ValidateCodeFunction;
  private readonly formatPhoneNumber: FormatPhoneNumberFunction;

  constructor(
    options: TwilioStrategyOptions,
    verify: StrategyVerifyCallback<User, TwilioStrategyParams>
  ) {
    super(verify);

    this.sessionPhoneKey = "twilio:phone";
    this.options = options;
    this.sendCode = options.sendCode ?? this.defaultSendCode;
    this.validateCode = options.validateCode ?? this.defaultValidateCode;
    this.formatPhoneNumber =
      options.formatPhoneNumber ?? this.defaultFormatPhoneNumber;

    this.client = twilio(options.accountSID, options.authToken);
  }

  async authenticate(
    request: Request,
    sessionStorage: SessionStorage,
    options: AuthenticateOptions
  ): Promise<User> {
    const session = await sessionStorage.getSession(
      request.headers.get("Cookie")
    );

    let user: User | null = session.get(options.sessionKey) ?? null;

    if (!user) {
      try {
        if (!options.successRedirect) {
          throw new Error("Missing required `successRedirect` property.");
        }

        const formData = await request.formData();
        const form = Object.fromEntries(formData.entries());
        const phone = form.phone && this.formatPhoneNumber(String(form.phone));
        const code = form.code && String(form.code);

        if (!phone) {
          return await this.failure(
            "Missing phone number.",
            request,
            sessionStorage,
            options
          );
        }

        if (code) {
          const validate = await this.validateCode({ code, phone });

          if (validate.status !== "approved") {
            return await this.failure(
              "Sorry, that code is invalid. Please try again.",
              request,
              sessionStorage,
              options
            );
          }

          user = await this.verify({
            phone,
            formData,
            request,
          });

          session.set(options.sessionKey, user);
          session.unset(this.sessionPhoneKey);
          session.unset(options.sessionErrorKey);

          throw redirect(options.successRedirect, {
            headers: {
              "Set-Cookie": await sessionStorage.commitSession(session),
            },
          });
        }

        await this.sendCode({ phone });

        session.flash(this.sessionPhoneKey, phone);
        session.unset(options.sessionErrorKey);

        throw redirect(options.successRedirect, {
          headers: {
            "Set-Cookie": await sessionStorage.commitSession(session),
          },
        });
      } catch (error) {
        if (error instanceof Response && error.status === 302) {
          throw error;
        }

        if (error instanceof Error) {
          return await this.failure(
            error.message,
            request,
            sessionStorage,
            options,
            error
          );
        }

        return await this.failure(
          "Unknown Error.",
          request,
          sessionStorage,
          options,
          new Error(JSON.stringify(error, null, 2))
        );
      }
    }

    if (!user) {
      throw new Error("Unable to authenticate.");
    }

    return this.success(user, request, sessionStorage, options);
  }

  private defaultSendCode = async ({ phone }: { phone: string }) => {
    return this.client.verify.v2
      .services(this.options.serviceSID)
      .verifications.create({
        to: phone,
        channel: "sms",
      });
  };

  private defaultValidateCode = async ({
    phone,
    code,
  }: {
    phone: string;
    code: string;
  }) => {
    return this.client.verify.v2
      .services(this.options.serviceSID)
      .verificationChecks.create({ to: phone, code })
      .catch((error) => {
        console.error(error);
        throw new Error("Sorry, that code is invalid. Please try again.");
      });
  };

  private defaultFormatPhoneNumber(num: string) {
    const result = phone(num);

    if (!result.isValid) {
      throw new Error("Invalid phone number.");
    }

    return result.phoneNumber;
  }
}
