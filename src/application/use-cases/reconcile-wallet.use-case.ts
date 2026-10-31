import { ReconcileWalletResult } from "../dtos/commands";
import { WalletLedgerRepositoryPort, WalletRepositoryPort } from "../ports/repository.ports";
import { WalletNotFoundError } from "../../domain/errors/domain.error";
import { Money } from "../../domain/models/money.vo";
import { LedgerDirection } from "../../domain/models/wallet-ledger-entry.entity";

export class ReconcileWalletUseCase {
  constructor(
    private readonly walletRepo: WalletRepositoryPort,
    private readonly ledgerRepo: WalletLedgerRepositoryPort,
  ) {}

  async execute(walletId: string): Promise<ReconcileWalletResult> {
    const wallet = await this.walletRepo.findById(walletId);
    if (!wallet) {
      throw new WalletNotFoundError(walletId);
    }

    const entries = await this.ledgerRepo.findAllByWalletId(walletId);

    // Sum all CREDITs and subtract all DEBITs
    let calculated = Money.zero(wallet.currency);
    for (const entry of entries) {
      if (entry.direction === LedgerDirection.Credit) {
        calculated = calculated.add(entry.money);
      } else {
        calculated = calculated.subtract(entry.money);
      }
    }

    const storedBalance = wallet.balance;
    const difference = storedBalance.subtract(calculated);
    const consistent = difference.isZero();

    return {
      walletId,
      storedBalance: storedBalance.toJSON(),
      calculatedBalance: calculated.toJSON(),
      difference: difference.toJSON(),
      consistent,
      checkedEntries: entries.length,
    };
  }
}
