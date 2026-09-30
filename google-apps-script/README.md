# Google Sheets — Embalagens e Operações

Planilha criada: **Kryzer Checkout - Embalagens e Operações**

Spreadsheet ID:

`1Je79NTOUZEEwC7FE9P5bapuuZme76vwM_E7jDg-a8dI`

## Regra funcional planejada

- **Pedido Item Único / mesmo SKU com quantidade > 1:** pode usar embalagem fixa mapeada no SKU.
- **Impressão em massa de Item Único:** pode aplicar a embalagem fixa do SKU a todos os pedidos do lote.
- **Kit / Múltiplos Itens:** nunca usa embalagem fixa automaticamente. A escolha da embalagem é obrigatória no checkout.
- Cada SKU é mantido uma única vez na aba `MAPEAMENTO_SKU`.
- Cada pedido é gravado uma única vez em `OPERACOES` usando uma chave de idempotência `PUID|orderId|ORIGINAL`.
- O custo da embalagem e o valor da operação são gravados como **snapshot histórico**, para alterações futuras de custo não mudarem cobranças antigas.
- O registro deve acontecer após confirmação física do Print Plugin (`printSuccess`), mesmo que o `mark-print` do UpSeller tenha atraso.
- Se o Google Sheets estiver temporariamente indisponível, o checkout deverá manter uma fila local e reenviar depois.

## Abas

### EMBALAGENS
Cadastro de embalagem: ID, nome, SKU da embalagem, custo, peso, comprimento, largura, altura e ativo.

### MAPEAMENTO_SKU
SKU único, título, embalagem fixa opcional, datas de primeiro/último uso, quantidade de pedidos, último PUID e contas vistas.

### CONTAS
PUID, nome da conta, cliente/CNPJ, valor padrão da operação e histórico de uso.

### OPERACOES
Histórico por pedido com PUID, conta, marketplace, pedido, SKUs, embalagem usada, custo, valor da operação, total cobrável e chave de idempotência.

### RESUMO
Consolidação automática por PUID/conta.

## Implantação do Apps Script

1. Abra a planilha.
2. Vá em **Extensões > Apps Script**.
3. Cole o conteúdo de `google-apps-script/checkout-packaging-api.gs` em `Code.gs`.
4. Em **Configurações do projeto > Propriedades do script**, adicione:
   - `API_TOKEN`: uma chave longa/aleatória.
5. **Implantar > Nova implantação > Aplicativo da Web**.
6. Executar como **Eu**.
7. Acesso: **Qualquer pessoa**.
8. Copie a URL terminada em `/exec`.
9. No Checkout, a URL pode ficar no código; o token deve ficar somente localmente no Tampermonkey/navegador e nunca no Git.
