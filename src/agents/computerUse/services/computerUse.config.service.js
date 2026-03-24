const AVAILABLE_MODELS = [
    {
        id: 'openrouter/free',
        provider: 'openrouter',
        label: 'OpenRouter Free',
        description: 'Modelo gratuito via OpenRouter',
    },
    {
        id: 'azure/gpt-4.1-nano',
        provider: 'azure-openai',
        label: 'Azure OpenAI GPT-4.1 Nano',
        description: 'Uso de deployment en Azure OpenAI con gpt-4.1-nano',
    },
    {
        id: 'azure/gpt-5-mini',
        provider: 'azure-openai',
        label: 'Azure OpenAI GPT-5 Mini',
        description: 'Uso de deployment en Azure OpenAI con gpt-5-mini',
    },
];

const NAVIGATION_POLICY_MODES = new Set(['free', 'allowlist', 'denylist']);
const NAVIGATION_BLOCK_BEHAVIORS = new Set(['block', 'skip']);

function normalizeDomainList(raw = []) {
    const source = Array.isArray(raw)
        ? raw
        : String(raw || '').split(',');

    return Array.from(new Set(
        source
            .map((item) => String(item || '').trim().toLowerCase())
            .map((item) => item.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
            .filter(Boolean)
    ));
}

function normalizeNavigationPolicy(input = {}, fallback = null) {
    const base = fallback || {
        mode: 'free',
        allowedDomains: [],
        blockedDomains: [],
        blockBehavior: 'block',
    };

    const modeRaw = String(input?.mode ?? base.mode ?? 'free').trim().toLowerCase();
    const blockBehaviorRaw = String(input?.blockBehavior ?? base.blockBehavior ?? 'block').trim().toLowerCase();

    return {
        mode: NAVIGATION_POLICY_MODES.has(modeRaw) ? modeRaw : 'free',
        allowedDomains: normalizeDomainList(input?.allowedDomains ?? base.allowedDomains ?? []),
        blockedDomains: normalizeDomainList(input?.blockedDomains ?? base.blockedDomains ?? []),
        blockBehavior: NAVIGATION_BLOCK_BEHAVIORS.has(blockBehaviorRaw) ? blockBehaviorRaw : 'block',
    };
}

function extractHostnameFromUrl(url = '') {
    const raw = String(url || '').trim();
    if (!raw) return '';

    try {
        const parsed = /^https?:\/\//i.test(raw) ? new URL(raw) : new URL(`https://${raw}`);
        return String(parsed.hostname || '').trim().toLowerCase();
    } catch {
        return '';
    }
}

function hostMatchesRule(hostname = '', rule = '') {
    const host = String(hostname || '').toLowerCase();
    const normalizedRule = String(rule || '').toLowerCase();
    if (!host || !normalizedRule) return false;

    if (normalizedRule.startsWith('*.')) {
        const base = normalizedRule.slice(2);
        return host === base || host.endsWith(`.${base}`);
    }

    return host === normalizedRule || host.endsWith(`.${normalizedRule}`);
}

export function isNavigationAllowedByPolicy(url = '', policy = {}) {
    const normalizedPolicy = normalizeNavigationPolicy(policy);
    const hostname = extractHostnameFromUrl(url);
    if (!hostname) {
        return { allowed: false, reason: 'URL invalida o sin dominio legible.' };
    }

    if (normalizedPolicy.mode === 'free') {
        return { allowed: true, reason: '' };
    }

    if (normalizedPolicy.mode === 'allowlist') {
        const allowed = normalizedPolicy.allowedDomains.some((rule) => hostMatchesRule(hostname, rule));
        if (allowed) return { allowed: true, reason: '' };
        return {
            allowed: false,
            reason: `Dominio bloqueado por allowlist: ${hostname}`,
        };
    }

    if (normalizedPolicy.mode === 'denylist') {
        const blocked = normalizedPolicy.blockedDomains.some((rule) => hostMatchesRule(hostname, rule));
        if (!blocked) return { allowed: true, reason: '' };
        return {
            allowed: false,
            reason: `Dominio bloqueado por denylist: ${hostname}`,
        };
    }

    return { allowed: true, reason: '' };
}

function normalizeAzureEndpoint(rawEndpoint = '') {
    const value = String(rawEndpoint || '').trim();
    if (!value) return '';

    // Accept full chat-completions URL from env and reduce it to resource endpoint.
    const withoutPath = value
        .replace(/\/openai\/deployments\/.+$/i, '')
        .replace(/\/openai\/chat\/completions.+$/i, '');

    return withoutPath.replace(/\/+$/, '');
}

function getAzureDefaultsForModel(modelId = '') {
    const selected = String(modelId || '').trim();

    if (selected === 'azure/gpt-5-mini') {
        return {
            endpoint: normalizeAzureEndpoint(
                process.env.AZURE_OPENAI_5_MINI_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT || ''
            ),
            apiKey: process.env.AZURE_OPENAI_5_MINI_API_KEY || process.env.AZURE_API_KEY || '',
            deployment:
                process.env.AZURE_OPENAI_5_MINI_DEPLOYMENT ||
                process.env.AZURE_OPENAI_5_MINI_MODEL ||
                'gpt-5-mini',
            apiVersion:
                process.env.AZURE_OPENAI_5_MINI_API_VERSION ||
                process.env.AZURE_OPENAI_API_VERSION ||
                '2025-04-01-preview',
        };
    }

    return {
        endpoint: normalizeAzureEndpoint(
            process.env.AZURE_OPENAI_4_1_NANO_ENDPOINT || process.env.AZURE_OPENAI_ENDPOINT || ''
        ),
        apiKey: process.env.AZURE_OPENAI_4_1_NANO_API_KEY || process.env.AZURE_API_KEY || '',
        deployment:
            process.env.AZURE_OPENAI_4_1_NANO_DEPLOYMENT ||
            process.env.AZURE_OPENAI_4_1_NANO_MODEL ||
            process.env.AZURE_OPENAI_MODEL ||
            'gpt-4.1-nano',
        apiVersion:
            process.env.AZURE_OPENAI_4_1_NANO_API_VERSION ||
            process.env.AZURE_OPENAI_API_VERSION ||
            '2024-12-01-preview',
    };
}

function buildInitialConfigFromEnv() {
        const initialNavigationPolicy = normalizeNavigationPolicy({
            mode: process.env.COMPUTER_USE_NAVIGATION_MODE || 'free',
            allowedDomains: process.env.COMPUTER_USE_ALLOWED_DOMAINS || '',
            blockedDomains: process.env.COMPUTER_USE_BLOCKED_DOMAINS || '',
            blockBehavior: process.env.COMPUTER_USE_NAVIGATION_BLOCK_BEHAVIOR || 'block',
        });

    const openRouterApiKey = process.env.OPENROUTER_API_KEY || '';

    const preferredProvider = String(process.env.COMPUTER_USE_MODEL_PROVIDER || '').trim();
    const preferredModel = String(process.env.COMPUTER_USE_MODEL || '').trim();

    // If Computer Use specific vars are not set, infer from existing Azure vars.
    const hasAzureBaseCreds = Boolean(process.env.AZURE_API_KEY) && Boolean(process.env.AZURE_OPENAI_ENDPOINT);
    const hasAzure5MiniCreds = Boolean(process.env.AZURE_OPENAI_5_MINI_API_KEY) && Boolean(process.env.AZURE_OPENAI_5_MINI_ENDPOINT);
    const azureModelFromEnv = String(process.env.AZURE_OPENAI_MODEL || '').trim().toLowerCase();

    const inferredModel =
        preferredModel ||
        (azureModelFromEnv === 'gpt-5-mini' ? 'azure/gpt-5-mini' : '') ||
        (azureModelFromEnv === 'gpt-4.1-nano' ? 'azure/gpt-4.1-nano' : '') ||
        (hasAzure5MiniCreds ? 'azure/gpt-5-mini' : '') ||
        (hasAzureBaseCreds ? 'azure/gpt-4.1-nano' : 'openrouter/free');

    const preferredAzureModel =
        inferredModel === 'azure/gpt-5-mini' || inferredModel === 'azure/gpt-4.1-nano'
            ? inferredModel
            : 'azure/gpt-4.1-nano';
    const azureDefaults = getAzureDefaultsForModel(preferredAzureModel);

    if (
        preferredProvider === 'azure-openai' ||
        inferredModel === 'azure/gpt-4.1-nano' ||
        inferredModel === 'azure/gpt-5-mini'
    ) {
        return {
            provider: 'azure-openai',
            model: preferredAzureModel,
            azure: {
                endpoint: azureDefaults.endpoint,
                apiKey: azureDefaults.apiKey,
                deployment: azureDefaults.deployment,
                apiVersion: azureDefaults.apiVersion,
            },
            openrouter: {
                apiKey: openRouterApiKey,
            },
            navigationPolicy: initialNavigationPolicy,
        };
    }

    return {
        provider: 'openrouter',
        model: 'openrouter/free',
        azure: {
            endpoint: azureDefaults.endpoint,
            apiKey: azureDefaults.apiKey,
            deployment: azureDefaults.deployment,
            apiVersion: azureDefaults.apiVersion,
        },
        openrouter: {
            apiKey: openRouterApiKey,
        },
        navigationPolicy: initialNavigationPolicy,
    };
}

let runtimeConfig = buildInitialConfigFromEnv();

function maskConfig(config) {
    return {
        provider: config.provider,
        model: config.model,
        azure: {
            endpoint: config.azure.endpoint,
            deployment: config.azure.deployment,
            apiVersion: config.azure.apiVersion,
            hasApiKey: Boolean(config.azure.apiKey),
        },
        openrouter: {
            hasApiKey: Boolean(config.openrouter.apiKey),
        },
        navigationPolicy: normalizeNavigationPolicy(config.navigationPolicy),
    };
}

export function listAvailableComputerUseModels() {
    return AVAILABLE_MODELS;
}

export function getComputerUseRuntimeConfig({ includeSecrets = false } = {}) {
    if (includeSecrets) {
        return runtimeConfig;
    }
    return maskConfig(runtimeConfig);
}

export function updateComputerUseRuntimeConfig(nextConfig = {}) {
    const nextProvider = String(nextConfig.provider || runtimeConfig.provider).trim();
    const nextModel = String(nextConfig.model || runtimeConfig.model).trim();

    if (!['openrouter', 'azure-openai'].includes(nextProvider)) {
        throw new Error('provider invalido. Usa "openrouter" o "azure-openai".');
    }

    const modelExists = AVAILABLE_MODELS.some(model => model.id === nextModel && model.provider === nextProvider);
    if (!modelExists) {
        throw new Error('model invalido para el provider seleccionado.');
    }

    const azureDefaultsForModel = getAzureDefaultsForModel(nextModel);

    runtimeConfig = {
        provider: nextProvider,
        model: nextModel,
        azure: {
            endpoint: normalizeAzureEndpoint(
                nextConfig.azure?.endpoint ?? runtimeConfig.azure.endpoint ?? azureDefaultsForModel.endpoint
            ),
            apiKey: String(
                nextConfig.azure?.apiKey ?? runtimeConfig.azure.apiKey ?? azureDefaultsForModel.apiKey
            ).trim(),
            deployment: String(
                nextConfig.azure?.deployment ?? runtimeConfig.azure.deployment ?? azureDefaultsForModel.deployment
            ).trim(),
            apiVersion: String(
                nextConfig.azure?.apiVersion ?? runtimeConfig.azure.apiVersion ?? azureDefaultsForModel.apiVersion
            ).trim(),
        },
        openrouter: {
            apiKey: String(nextConfig.openrouter?.apiKey ?? runtimeConfig.openrouter.apiKey ?? '').trim(),
        },
        navigationPolicy: normalizeNavigationPolicy(nextConfig.navigationPolicy, runtimeConfig.navigationPolicy),
    };

    if (runtimeConfig.provider === 'azure-openai') {
        if (!runtimeConfig.azure.endpoint || !runtimeConfig.azure.apiKey || !runtimeConfig.azure.deployment) {
            throw new Error('Para azure-openai se requiere endpoint, apiKey y deployment.');
        }
    }

    if (runtimeConfig.provider === 'openrouter' && !runtimeConfig.openrouter.apiKey) {
        throw new Error('Para openrouter se requiere apiKey.');
    }

    return maskConfig(runtimeConfig);
}
