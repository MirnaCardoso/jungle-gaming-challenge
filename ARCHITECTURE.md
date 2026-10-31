# Arquitetura — Distributed Wagering Processor

Este documento descreve as decisões de arquitetura, padrões adotados, justificativas técnicas, trade-offs e garantias do **Distributed Wagering Processor** da Jungle Gaming.

---

## 1. Visão Geral da Arquitetura

O sistema adota os princípios de **Clean Architecture** e **Domain-Driven Design (DDD)** para desacoplar as regras financeiras centrais de detalhes de transporte (HTTP/SQS) e persistência (PostgreSQL/MikroORM).

```
src/
├── domain/                  # Núcleo de domínio puro (independente de frameworks)
│   ├── models/              # Aggregates, Entities e Value Objects (Money, Wallet, Ledger, etc.)
│   ├── events/              # Eventos de integração tipados (IntegrationEvent<T>)
│   ├── errors/              # Exceções e erros semânticos de domínio
│   └── utils/               # Utilitários puros (JSON Canônico e SHA-256 Hash)
├── application/             # Casos de uso e orquestração transacional
│   ├── use-cases/           # CreateWallet, ProcessWagerTransaction, Reconcile, etc.
│   ├── ports/               # Interfaces/Portas de repositórios e serviços de infraestrutura
│   └── dtos/                # Comandos, parâmetros e resultados de aplicação
├── infrastructure/          # Adaptadores e implementações concretas
│   ├── database/            # MikroORM, entidades mapeadas, repositories e migrations SQL
│   ├── messaging/           # Consumidor e publicador AWS SQS (LocalStack)
│   └── observability/       # Logger estruturado (Pino), Métricas e Health Indicators
└── presentation/            # Camada de apresentação externa
    └── http/                # Controllers NestJS, DTOs de validação Zod e Exception Filters
```

---

## 2. Decisões Técnicas e Invariantes

### 2.1 Precisão Monetária (`Money`)
- **Problema:** Ponto flutuante binário padrão (`number`, `float`, `double`) sofre de imprecisões aritméticas inaceitáveis para sistemas financeiros (ex.: `0.1 + 0.2 !== 0.3`).
- **Decisão:** Implementação de um Value Object `Money` imutável encapsulando a biblioteca `decimal.js`.
- **Garantias:**
  - Valores são representados internamente como decimais arbitrários e serializados como strings com escala estrita de **2 casas decimais** (`amount: string`, `currency: string`).
  - Entradas inválidas (`NaN`, `Infinity`, notação científica `1e5`, strings vazias, mais de 2 casas decimais) são rejeitadas com `InvalidMoneyError`.
  - Operações aritméticas entre moedas distintas lançam `CurrencyMismatchError`.

### 2.2 Concorrência e Hot Wallets (`walletId` como unidade de lock)
- **Problema:** Múltiplas instâncias ou workers concorrentes processando apostas ou prêmios na mesma carteira podem ocasionar *lost updates* e saldo negativo.
- **Decisão:** Adotou-se **Pessimistic Locking por Wallet** (`SELECT ... FOR UPDATE` no PostgreSQL) associado a **Double-Checked Locking de Idempotência**.
- **Justificativa:** Em ambientes de iGaming com apostas em tempo real (ex.: jogos crash, slots de múltiplos giros), *optimistic locking* puro com retries gera alta taxa de abortos e desperdício de recursos sob contenção extrema. O lock pessimista delimita a contenção estritamente à `walletId` específica, permitindo que todas as demais carteiras sejam processadas em paralelo sem nenhuma interferência.
- **Garantia com 50+ requisições simultâneas:**
  1. A primeira requisição obtém o lock de escrita da carteira no PostgreSQL.
  2. As 49 requisições subsequentes aguardam na fila do banco pelo lock dessa carteira.
  3. Assim que a primeira conclui e commita a transação, a segunda adquire o lock e imediatamente executa o *double-check* de idempotência: ao encontrar a transação já comitada pela requisição 1, retorna o replay idempotente (`idempotentReplay: true`) sem duplicar débitos.

### 2.3 Idempotência Persistente & JSON Canônico
- **Decisão:** Header `Idempotency-Key` obrigatório armazenado na tabela `wager_transactions` com constraint `UNIQUE`.
- **Prevenção de Ataques de Replay Modificado:**
  - O sistema calcula o `payloadHash` (SHA-256) sobre um **JSON Canônico** (onde todas as chaves do objeto de negócio são ordenadas deterministicamente em árvore, ignorando cabeçalhos de transporte).
  - Se a mesma `Idempotency-Key` for reenviada com os mesmos parâmetros: retorna a resposta original com `idempotentReplay: true`.
  - Se a mesma `Idempotency-Key` for reenviada com dados divergentes (ex.: alteração de valor ou moeda): lança `IdempotencyConflictError` (HTTP 409 Conflict).

### 2.4 Consistência Atômica: Saldo, Ledger, Inbox e Outbox
- **Problema:** Falhas entre a gravação do saldo e a publicação de eventos em mensageria podem deixar o sistema inconsistente (Dual-Write problem).
- **Decisão:** **Transactional Outbox Pattern** & **Persistent Inbox Pattern**.
- Todas as operações participam da **mesma transação SQL**:
  1. Atualização do saldo materializado da `Wallet`.
  2. Criação do registro imutável em `wallet_ledger_entries`.
  3. Atualização/Criação da `WagerTransaction`.
  4. Registro da mensagem no `inbox_messages` (se proveniente do SQS).
  5. Enfileiramento do evento na tabela `outbox_messages`.
- **Garantia:** Se qualquer etapa falhar, o PostgreSQL desfaz toda a operação. O evento só pode existir na tabela `outbox_messages` se o saldo e o ledger forem comitados.
- Um worker independente consome a tabela `outbox_messages` com `FOR UPDATE SKIP LOCKED` para publicação no SQS com retry e backoff exponencial.

### 2.5 Imutabilidade e Integridade Aplicadas no Banco de Dados
Conforme exigido pelo desafio, as garantias não residem apenas em código TypeScript; elas são asseguradas pelo schema PostgreSQL:
1. `chk_wallet_balance_non_negative`: `CHECK (balance_amount >= 0)` impede saldo negativo no nível de engine.
2. `uq_wallet_player_currency`: `UNIQUE (player_id, currency)` impede mais de uma carteira por jogador e moeda.
3. `uq_idempotency_key`: `UNIQUE (idempotency_key)` impede duplicidade física de transações.
4. `chk_ledger_amount_positive`: `CHECK (amount > 0)`.
5. `chk_ledger_balanced_arithmetic`: `CHECK ((direction = 'CREDIT' AND balance_before_amount + amount = balance_after_amount) OR (direction = 'DEBIT' AND balance_before_amount - amount = balance_after_amount))`.
6. **Trigger de Imutabilidade do Ledger:** Uma trigger PL/pgSQL (`prevent_ledger_mutation`) dispara erro fatal caso qualquer instrução `UPDATE` ou `DELETE` seja emitida na tabela `wallet_ledger_entries`.

### 2.6 Autenticação (Decisão e Ponto de Extensão)
Conforme detalhado na Seção 2 do desafio, a autenticação não pontua e não deve desviar o foco da correção financeira e concorrência.
- **Desenho Recomendado:** Integração com Identity Provider externo OIDC (ex.: **Zitadel** ou **Keycloak**) emitindo JWTs assinados via RS256/EdDSA.
- **Ponto de Extensão:** No NestJS, a validação é centralizada em Guards/Interceptors através de uma porta `ProviderIdentityPort`. Endpoints de `/health/live` e `/health/ready` permanecem desprotegidos para sondas de orquestração (Kubernetes / Docker).

---

## 3. Trade-offs e Limitações

| Decisão | Vantagem | Trade-off / Custo |
|---|---|---|
| **Pessimistic Lock por `walletId`** | Elimina lost updates e garante estrita consistência sem loops de retry; ideal para contenção severa | Sob altíssima concorrência em uma única carteira, requisições formam fila no banco até o tempo limite do lock |
| **Outbox com polling `SKIP LOCKED`** | Simples, robusto, seguro entre múltiplas instâncias sem duplicação | Pequena latência de publicação vinculada ao intervalo de varredura do worker |
| **Double-Entry opcional** | Foco mantido no escopo de Ledger de movimentação da carteira com balanço aritmético | Balanço de contas de contrapartida do provedor / cassino não é modelado nesta etapa |

---

## 4. Instruções de Execução

### Pré-requisitos
- **Bun 1.x**
- **Docker & Docker Compose** (para PostgreSQL e LocalStack SQS)

### Subir Infraestrutura Local
```bash
docker compose up -d
```

### Executar Migrations
```bash
bun run mikro-orm migration:up
```

### Executar a Aplicação
```bash
# Modo desenvolvimento (com hot-reload)
bun run start:dev

# Modo produção
bun run start
```

### Executar os Testes
```bash
# Executar todos os testes (unitários e concorrência)
bun test

# Executar apenas testes de concorrência
bun test test/concurrency

# Verificação estrita de tipagem TypeScript
bun run lint
```
