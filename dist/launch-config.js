// Use only an actual Google-registered FF prompt ID, tested with that spell.
// Example entry shape: { ios: { url: 'actual-tested-google-url', verified: true } }
// Verify each platform separately and retain the complete tested URL unchanged.
// The old campaign's DQ IDs cannot run these FF instructions. No IDs are invented.
export const REGISTERED_PROMPTS = Object.freeze({
  ultima: null, flare: null, holy: null,
  thundaga: null, blizzaga: null, meteor: null
});
