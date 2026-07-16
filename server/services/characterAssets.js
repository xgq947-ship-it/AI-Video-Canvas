import crypto from 'crypto';

export function normalizeCharacterAssetMeta({
    category,
    meta,
    libraryData,
    createId = () => crypto.randomUUID()
}) {
    const normalizedMeta = { ...(meta || {}) };
    if (category !== 'Character' || !normalizedMeta.characterName?.trim()) {
        return normalizedMeta;
    }

    normalizedMeta.characterName = normalizedMeta.characterName.trim();
    const sameCharacter = libraryData.find(entry =>
        entry.category === 'Character' &&
        entry.characterName?.trim().toLowerCase() === normalizedMeta.characterName.toLowerCase()
    );
    normalizedMeta.characterId = sameCharacter?.characterId || normalizedMeta.characterId || createId();

    if (normalizedMeta.characterAssetRole?.startsWith('look-') && normalizedMeta.lookName?.trim()) {
        normalizedMeta.lookName = normalizedMeta.lookName.trim();
        const sameLook = libraryData.find(entry =>
            entry.characterId === normalizedMeta.characterId &&
            entry.lookName?.trim().toLowerCase() === normalizedMeta.lookName.toLowerCase()
        );
        normalizedMeta.lookId = sameLook?.lookId || normalizedMeta.lookId || createId();
    } else {
        delete normalizedMeta.lookId;
        delete normalizedMeta.lookName;
    }

    return normalizedMeta;
}
