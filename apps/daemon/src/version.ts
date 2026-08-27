// Inlined at compile time by `--define process.env.SCHOOL_BUDDY_VERSION=...`
// in the release workflow; "dev" when running from the repo.
export const VERSION: string = process.env.SCHOOL_BUDDY_VERSION ?? "dev"
