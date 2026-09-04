/**
 * @typedef {"cursor" | "gemini"} BackendId
 * @typedef {"cursor_login" | "none"} AuthMethod
 *
 * @typedef {Object} ProxyConfig
 * @property {BackendId} backend
 * @property {AuthMethod} authMethod
 * @property {string} agentName
 * @property {string} agentVersion
 * @property {string} cwd
 * @property {string | undefined} defaultModel
 * @property {Record<string, string> | undefined} defaultModelParameters
 * @property {boolean} autoApprovePermissions
 * @property {string} agentCommand
 * @property {string[]} agentArgs
 * @property {string} logDir
 */

export {};
