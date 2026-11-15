/** IDs internos preservam a PK global e isolam também os objetos de mídia. */
export function evolutionMessageId(instanceName: string, providerId: string): string {
  return `evo:${encodeURIComponent(instanceName)}:${encodeURIComponent(providerId)}`;
}

/** Somente IDs da própria instância são traduzidos ao citar no WhatsApp. */
export function evolutionProviderMessageId(instanceName: string, internalId: string): string {
  const prefix = `evo:${encodeURIComponent(instanceName)}:`;
  if (!internalId.startsWith(prefix)) return internalId;
  return decodeURIComponent(internalId.slice(prefix.length));
}
