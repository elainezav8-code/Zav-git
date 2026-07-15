# Frentes

App pessoal de gestão de atenção. A pessoa fala uma frase solta; o sistema
estrutura. Registro é subproduto, nunca tarefa.

## Arquitetura

- **Dados:** planilha Google no Drive da usuária, criada automaticamente pelo
  script (abas Frentes, Passos, Ideias, Registro e Config).
- **Backend:** Web App do Google Apps Script (`backend/Code.gs`). Chave da API
  Anthropic e token de acesso ficam em Propriedades do script, nunca no cliente.
- **IA:** claude-sonnet-4-6 via API Anthropic, chamado pelo Apps Script
  (entra na etapa 2).
- **Frontend:** PWA estático (HTML/JS/CSS, sem build) publicado pelo GitHub
  Pages, instalável na tela de início do iPhone. No primeiro acesso pede a URL
  do Web App e o token, uma única vez por aparelho.
- **Lembrete:** sem servidor de push na v1; um Atalho do iOS abre o app em
  horário fixo.

## Etapas

- [x] Etapa 0: pipeline de dispatch validado
- [x] Etapa 1: backend + planilha respondendo (validada em 13/07/2026:
      GET e POST funcionando, gravação conferida na planilha)
- [ ] Etapa 2: parsing pela IA (código pronto, aguardando atualização do
      script e validação)
- [ ] Etapa 3: telas (Hoje, Frentes, Ideias)
- [ ] Etapa 4: instalação no iPhone

URL do Web App (implantação atual, termina em /exec):
`https://script.google.com/macros/s/AKfycbyDJzsJpAfnB6LYB6RtYNcJRwDjg2YQ_qTm-HdEWKBlaZ5toVYgJvX6KoBzqZCCbHveOQ/exec`

## Regras do sistema

Máximo 4 frentes ativas (aviso ao exceder). Frente sem toque há mais de 30 dias
sugere congelamento. Ideia fica 72h em quarentena antes de poder ser julgada.
O app guarda estado e ponteiros, nunca conteúdo institucional.
