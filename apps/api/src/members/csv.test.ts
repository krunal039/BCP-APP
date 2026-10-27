import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemberCsvRowSchema } from "@bcp/shared";
import { parseCsv } from "./csv.js";

describe("parseCsv", () => {
  it("parses header aliases and DRC rows", () => {
    const csv = [
      "name,phone,country,group",
      "Jean Mbala,+243900000001,CD,Mine Site A",
      "Amina Kabila,+243900000002,,Site B",
    ].join("\n");

    const { rows, errors } = parseCsv(csv);
    assert.equal(errors.length, 0);
    assert.equal(rows.length, 2);
    assert.equal(rows[0]!.displayName, "Jean Mbala");
    assert.equal(rows[0]!.e164, "+243900000001");
    assert.equal(rows[0]!.countryCode, "CD");
    assert.equal(rows[0]!.groupName, "Mine Site A");

    const validated = MemberCsvRowSchema.parse(rows[1]);
    assert.equal(validated.countryCode, "CD");
    assert.equal(validated.displayName, "Amina Kabila");
    assert.equal(validated.groupName, "Site B");
  });

  it("rejects missing required headers", () => {
    const { errors, rows } = parseCsv("foo,bar\n1,2");
    assert.equal(rows.length, 0);
    assert.ok(errors[0]?.message.includes("displayName"));
  });

  it("rejects invalid E.164 via schema", () => {
    const { rows } = parseCsv("displayName,e164\nBad,243900");
    const parsed = MemberCsvRowSchema.safeParse(rows[0]);
    assert.equal(parsed.success, false);
  });

  it("handles quoted commas", () => {
    const csv = 'displayName,e164\n"Mbala, Jean",+243900000099';
    const { rows } = parseCsv(csv);
    assert.equal(rows[0]!.displayName, "Mbala, Jean");
  });
});
