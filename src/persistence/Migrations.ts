import { BOARD_SCHEMA_VERSION } from "../core/types";

export class UnsupportedBoardVersionError extends Error {
  constructor(public readonly version: number) {
    super(`Board format version ${version} is newer than this version of Caseboard supports.`);
    this.name = "UnsupportedBoardVersionError";
  }
}

type RawBoard = Record<string, unknown>;
type Migration = (board: RawBoard) => RawBoard;

/**
 * Migrations are applied in ascending target-version order. Version 1 is the
 * initial format; the table exists so future formats can be upgraded safely.
 */
const MIGRATIONS: Record<number, Migration> = {};

export interface MigrationOutcome {
  board: RawBoard;
  applied: number[];
}

export function migrateBoard(raw: RawBoard): MigrationOutcome {
  let version =
    typeof raw.schemaVersion === "number" && Number.isFinite(raw.schemaVersion)
      ? Math.floor(raw.schemaVersion)
      : 0;

  if (version > BOARD_SCHEMA_VERSION) {
    throw new UnsupportedBoardVersionError(version);
  }

  let board = raw;
  const applied: number[] = [];
  while (version < BOARD_SCHEMA_VERSION) {
    const nextVersion = version + 1;
    const migration = MIGRATIONS[nextVersion];
    if (migration) {
      board = migration(board);
      applied.push(nextVersion);
    }
    version = nextVersion;
  }

  board.schemaVersion = BOARD_SCHEMA_VERSION;
  return { board, applied };
}
