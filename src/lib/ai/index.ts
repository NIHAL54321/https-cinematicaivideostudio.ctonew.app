/**
 * AI Model Orchestrator — public entry point (SERVER-ONLY).
 *
 * Import from here anywhere on the server. Never import this from a client
 * component: provider env values live behind this module and must never reach
 * a client bundle.
 */
export * from "./types";
export * from "./router";
export {
  execute,
  enqueue,
  requiredEnvFor,
  DEFAULT_ATTEMPTS_LIMIT,
  type ExecuteOptions,
  type AiPersistence,
  type GenerationCreateInput,
  type GenerationUpdateInput,
  type ProviderLogInput,
} from "./orchestrator";
export { capabilityStatus, allCapabilityStatus, type CapabilityStatusInfo, type CapabilityProviderState } from "./status";
export { prismaAiPersistence, toGenerationTaskType } from "./persistence";
export {
  registerProvider,
  seedDefaultProviders,
  providersFor,
  allProviders,
  getProvider,
  registeredTestProviders,
  type RegisterOptions,
} from "./providers/registry";
export {
  HttpProviderBase,
  mapHttpStatus,
  type HttpProviderConfig,
  type HttpEndpoint,
} from "./providers/http-provider";
export {
  isProviderReady,
  ProviderNotWiredError,
  type AiProvider,
  type ProviderCallOptions,
  type ProviderCallResult,
  type ProviderCallStatus,
  type ProviderMetadata,
} from "./providers/types";
export { PROVIDER_SLOTS } from "./providers/slots";
export {
  PROVIDER_ENV_KEYS,
  providerEnvConfigured,
  providerRequiredEnv,
  allProviderEnvVars,
  type ProviderEnvKeySpec,
} from "./providers/env-keys";
export {
  capabilityEnvPath,
  capabilityEnvNames,
  capabilityEnvNamesFor,
  capabilityEnvHint,
  capabilityEnvRequirement,
  envNamesPhrase,
  isRegistryEnvVar,
  registryEnvVars,
  listCapabilityEnvPaths,
  type CapabilityEnvPath,
  type CapabilityProviderEnvPath,
} from "./providers/capability-env";
