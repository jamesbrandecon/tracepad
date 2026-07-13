import { useEffect, useState } from "react";
import type { ProviderConfiguration, ProviderStatusResponse } from "../core/types";

export function ProviderSetup({
  status,
  busy,
  error,
  onConfigure,
  onClose
}: {
  status: ProviderStatusResponse;
  busy: boolean;
  error: string | null;
  onConfigure: (configuration: ProviderConfiguration) => void;
  onClose: () => void;
}) {
  const initialProfile = status.active_profile
    || status.profiles.find(profile => profile.configured)?.id
    || status.profiles[0]?.id
    || "";
  const [selected, setSelected] = useState(initialProfile);
  const profile = status.profiles.find(item => item.id === selected);
  const provider = status.providers.find(item => item.id === profile?.provider);
  const [model, setModel] = useState(profile?.model ?? "");
  const [baseUrl, setBaseUrl] = useState(provider?.base_url ?? "");
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    const nextProfile = status.profiles.find(item => item.id === selected);
    const nextProvider = status.providers.find(item => item.id === nextProfile?.provider);
    setModel(nextProfile?.model ?? "");
    setBaseUrl(nextProvider?.base_url ?? "");
    setApiKey("");
  }, [selected, status.profiles, status.providers]);

  const submitConfiguration = () => {
    if (!profile || !provider || !model.trim()) return;
    onConfigure({
      profile: selected,
      provider: provider.id,
      model: model.trim(),
      api_key: provider.requires_api_key ? apiKey.trim() || undefined : undefined,
      base_url: baseUrl.trim() || undefined
    });
  };

  return (
    <div className="tp-provider-backdrop" role="presentation">
      <section className="tp-provider-dialog" role="dialog" aria-modal="true" aria-labelledby="tracepad-provider-title">
        <header>
          <div>
            <span>AI models</span>
            <h2 id="tracepad-provider-title">Connect Tracepad</h2>
            <p>Choose a provider and an exact model name. Tracepad never selects a default model. Credentials stay in the Jupyter server process.</p>
          </div>
          <button className="tp-icon" type="button" aria-label="Close AI setup" onClick={onClose}>×</button>
        </header>

        {profile && provider ? (
          <form className="tp-provider-form" onSubmit={event => {
            event.preventDefault();
            submitConfiguration();
          }}>
            <label>
              Model profile
              <select value={selected} onChange={event => setSelected(event.target.value)}>
                {status.profiles.map(item => (
                  <option key={item.id} value={item.id}>{item.label} · {item.model || "model required"}</option>
                ))}
              </select>
            </label>
            <div className="tp-profile-summary">
              <strong>{provider.label}</strong>
              <span>{provider.driver} · {profile.configured ? "ready" : "setup required"}</span>
            </div>
            {provider.requires_api_key ? (
              <label>
                API key
                <input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={provider.configured ? "Configured on the server" : `Enter ${provider.label} key`} autoComplete="off" />
              </label>
            ) : null}
            <label>
              Endpoint
              <input value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="Provider base URL" />
            </label>
            <label>
              Model
              <input value={model} onChange={event => setModel(event.target.value)} list="tracepad-profile-models" placeholder="Model name" />
              <datalist id="tracepad-profile-models">{provider.models.map(name => <option key={name} value={name} />)}</datalist>
            </label>
            {profile.error && !profile.configured ? <p className="tp-provider-hint">{profile.error}</p> : null}
            {error ? <p className="tp-provider-error">{error}</p> : null}
            {status.config_files?.length ? <p className="tp-provider-config-source">Loaded from {status.config_files.join(", ")}</p> : null}
            <div className="tp-provider-actions">
              <button className="tp-secondary" type="button" onClick={onClose}>Cancel</button>
              <button className="tp-primary" type="button" disabled={busy || !model.trim()} onClick={submitConfiguration}>{busy ? "Connecting" : `Use ${profile.label}`}</button>
            </div>
          </form>
        ) : <p className="tp-provider-error">{status.error || "No model profiles are available."}</p>}
      </section>
    </div>
  );
}
