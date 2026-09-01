import type { NextConfig } from "next";
import { env } from "./lib/env";

// Checked here so a misconfigured deploy fails the build rather than answering
// 501 at runtime and looking like a deliberate local-only one. Called for the
// throw, not the value.
env();

const nextConfig: NextConfig = {};

export default nextConfig;
