# Etapa 1: instalar o backend e ver a planilha respondendo

Tempo estimado: 10 minutos, uma vez só. Ao final você terá um endereço web que
devolve o estado das suas frentes em JSON e grava na planilha as frases que
receber.

## 1. Criar o projeto

1. Abra [script.google.com](https://script.google.com) logada na sua conta Google.
2. Clique em **Novo projeto**.
3. Renomeie o projeto (clique em "Projeto sem título") para `Frentes backend`.
4. Apague todo o conteúdo do arquivo `Código.gs` e cole o conteúdo de
   [`Code.gs`](Code.gs) deste repositório.
5. Salve (ícone de disquete ou Cmd+S).

## 2. Configurar o token

1. Clique na engrenagem **Configurações do projeto**, no menu lateral.
2. Role até **Propriedades do script** e clique em **Adicionar propriedade do script**.
3. Propriedade: `TOKEN_ACESSO`. Valor: uma senha longa que só você conhece
   (pode ser qualquer coisa; se rodar a função `configurar` antes deste passo,
   o log sugere um token aleatório pronto para copiar).
4. Aproveite e crie também `ANTHROPIC_API_KEY` com a sua chave da Anthropic.
   Ela não é usada na etapa 1, mas deixá-la pronta evita voltar aqui na etapa 2.
5. Salve as propriedades do script.

## 3. Autorizar e criar a planilha

1. Volte ao **Editor** (menu lateral).
2. Na barra de cima, escolha a função `configurar` e clique em **Executar**.
3. O Google vai pedir autorização: escolha sua conta, clique em **Avançado** e
   depois em **Acessar Frentes backend (não seguro)**. Esse aviso aparece porque
   o script é seu, não publicado na loja; é esperado.
4. No log de execução deve aparecer `Planilha pronta:` com o endereço da
   planilha `Frentes (dados)` criada no seu Drive. Abra para conferir as abas
   Frentes, Passos, Ideias, Registro e Config.

## 4. Publicar o Web App

1. Clique em **Implantar > Nova implantação**.
2. Na engrenagem ao lado de "Selecionar tipo", escolha **App da Web**.
3. Preencha:
   - Descrição: `etapa 1`
   - Executar como: **Eu**
   - Quem pode acessar: **Qualquer pessoa**
4. Clique em **Implantar** e copie a **URL do app da Web** (termina em `/exec`).

Importante: toda vez que o código mudar (etapas seguintes), é preciso ir em
**Implantar > Gerenciar implantações**, editar a implantação existente e trocar
a versão para **Nova versão**. Sem isso a URL continua servindo o código velho.

## 5. Testar

**Teste 1, no navegador (iPhone ou Mac).** Abra:

```
SUA_URL/exec?token=SEU_TOKEN
```

Deve aparecer um JSON com `"ok":true` e listas vazias de frentes e ideias.
Se aparecer `token invalido`, o token da URL não bate com a propriedade.

**Teste 2, gravação (no Mac, Terminal).**

```
curl -L -X POST 'SUA_URL/exec' \
  -H 'Content-Type: text/plain' \
  -d '{"token":"SEU_TOKEN","texto":"teste da etapa um"}'
```

Deve voltar `"ok":true` com o eco da frase, e a frase deve aparecer na aba
**Registro** da planilha. Isso prova o caminho completo: requisição, token,
escrita na planilha, resposta JSON.

## 6. Me validar a etapa

Quando os dois testes passarem, me diga (pode ser uma frase solta, como manda o
projeto). Aí eu construo a etapa 2: a IA lendo suas frases e devolvendo as
ações estruturadas.
