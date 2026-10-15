import { describe, expect, it } from "vitest";
import {
  canOpenBackOfficePath,
  deviceHome,
  isBackOfficePath,
  isDeviceScreenPath,
  safeNextPath,
} from "./routes";

describe("isBackOfficePath", () => {
  it("matches /admin and /manager and their sub-pages only", () => {
    expect(isBackOfficePath("/admin")).toBe(true);
    expect(isBackOfficePath("/admin/staff")).toBe(true);
    expect(isBackOfficePath("/manager")).toBe(true);
    expect(isBackOfficePath("/manager/staff")).toBe(true);
    expect(isBackOfficePath("/administrator")).toBe(false);
    expect(isBackOfficePath("/till")).toBe(false);
    expect(isBackOfficePath("/")).toBe(false);
  });
});

describe("isDeviceScreenPath", () => {
  it("matches device screens", () => {
    expect(isDeviceScreenPath("/till")).toBe(true);
    expect(isDeviceScreenPath("/kds")).toBe(true);
    expect(isDeviceScreenPath("/pickup")).toBe(true);
    expect(isDeviceScreenPath("/device/setup")).toBe(false);
    expect(isDeviceScreenPath("/tills")).toBe(false);
  });
});

describe("canOpenBackOfficePath", () => {
  it("lets admins open everything and managers only /manager", () => {
    expect(canOpenBackOfficePath("admin", "/admin")).toBe(true);
    expect(canOpenBackOfficePath("admin", "/manager")).toBe(true);
    expect(canOpenBackOfficePath("manager", "/manager/staff")).toBe(true);
    expect(canOpenBackOfficePath("manager", "/admin")).toBe(false);
    expect(canOpenBackOfficePath("manager", "/admin/branches")).toBe(false);
  });
});

describe("deviceHome", () => {
  it("maps device types to their screens", () => {
    expect(deviceHome("till")).toBe("/till");
    expect(deviceHome("kds")).toBe("/kds");
    expect(deviceHome("pickup")).toBe("/pickup");
  });
});

describe("safeNextPath", () => {
  it("keeps allowed back-office paths and query strings", () => {
    expect(safeNextPath("/admin/staff?branch=1", "admin")).toBe(
      "/admin/staff?branch=1",
    );
    expect(safeNextPath("/manager", "manager")).toBe("/manager");
    expect(safeNextPath("/device/setup", "manager")).toBe("/device/setup");
  });

  it("refuses paths the role can't open", () => {
    expect(safeNextPath("/admin", "manager")).toBeNull();
  });

  it("refuses non back-office paths", () => {
    expect(safeNextPath("/till", "admin")).toBeNull();
    expect(safeNextPath("/", "admin")).toBeNull();
  });

  it("refuses redirects to other sites", () => {
    expect(safeNextPath("https://evil.example/admin", "admin")).toBeNull();
    expect(safeNextPath("//evil.example/admin", "admin")).toBeNull();
    expect(safeNextPath("/\\evil.example/admin", "admin")).toBeNull();
    expect(safeNextPath("admin", "admin")).toBeNull();
  });

  it("handles empty input", () => {
    expect(safeNextPath(null, "admin")).toBeNull();
    expect(safeNextPath(undefined, "admin")).toBeNull();
    expect(safeNextPath("", "admin")).toBeNull();
  });
});
