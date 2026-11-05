import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  validateNewPassword,
} from "@/lib/password-rules";

describe("validateNewPassword", () => {
  it("asks for a password when there is none", () => {
    expect(validateNewPassword("")).toBe("Please enter a new password.");
    expect(validateNewPassword(undefined)).toBe("Please enter a new password.");
    expect(validateNewPassword(null)).toBe("Please enter a new password.");
  });

  it("rejects anything shorter than the minimum", () => {
    const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
    expect(validateNewPassword(short)).toBe(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  });

  it("accepts the minimum and anything longer", () => {
    expect(validateNewPassword("a".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
    expect(validateNewPassword("a long enough passphrase")).toBeNull();
  });

  it("rejects a value that is not a string, whatever the client sent", () => {
    expect(validateNewPassword(12345678)).toBe("Please enter a new password.");
    expect(validateNewPassword({ length: 99 })).toBe(
      "Please enter a new password."
    );
  });
});
