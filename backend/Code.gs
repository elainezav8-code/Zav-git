/**
 * Frentes: backend (etapa 2)
 *
 * Web App do Google Apps Script. Os dados moram em uma planilha no Drive.
 * Nenhum conteudo institucional e guardado aqui: so estado e ponteiros.
 *
 * Propriedades do script (Configuracoes do projeto > Propriedades do script):
 *   TOKEN_ACESSO       token secreto que o app envia em cada chamada
 *   ANTHROPIC_API_KEY  chave da API Anthropic
 *
 * Etapa 2: o doPost envia a frase da usuaria junto com o estado atual para a
 * IA (claude-sonnet-4-6), recebe um JSON de acoes e aplica na planilha.
 */

var NOME_PLANILHA = 'Frentes (dados)';

// Planilha ja criada no Drive da Elaine em 13/07/2026. O script adota esta;
// se ela for apagada um dia, o script cria outra sozinho e segue a vida.
var PLANILHA_ID_PADRAO = '1BzMVkn78Ey9VxNui1VoZz2ZgmiayxIPUnv7A6GQrSz4';

var MODELO_IA = 'claude-sonnet-4-6';

var CABECALHOS = {
  Frentes: ['id', 'nome', 'status', 'onde_parei', 'rumo', 'ultimo_toque', 'criada_em', 'fundamento'],
  Passos: ['id', 'frente_id', 'ordem', 'descricao', 'feito_em'],
  Ideias: ['id', 'texto', 'capturada_em', 'status'],
  Registro: ['data', 'texto', 'acoes_json'],
  Config: ['chave', 'valor']
};

var LIMITE_FRENTES_ATIVAS = 4;
var QUARENTENA_HORAS = 72;
var DIAS_PARA_SUGERIR_CONGELAMENTO = 30;

/**
 * Rode esta funcao uma vez pelo editor (botao Executar) para autorizar os
 * acessos e preparar a planilha. O endereco da planilha sai no log.
 */
function configurar() {
  var planilha = planilha_();
  Logger.log('Planilha pronta: ' + planilha.getUrl());

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN_ACESSO')) {
    Logger.log('FALTA a propriedade TOKEN_ACESSO. Sugestao de token: ' + Utilities.getUuid());
  } else {
    Logger.log('TOKEN_ACESSO configurado.');
  }
  if (!props.getProperty('ANTHROPIC_API_KEY')) {
    Logger.log('FALTA a propriedade ANTHROPIC_API_KEY. Sem ela a etapa 2 nao funciona.');
  } else {
    Logger.log('ANTHROPIC_API_KEY configurada.');
  }
}

function doGet(e) {
  try {
    var token = e && e.parameter ? e.parameter.token : null;
    if (!tokenValido_(token)) {
      return responder_({ ok: false, erro: 'token invalido' });
    }
    return responder_(estado_());
  } catch (erro) {
    return responder_({ ok: false, erro: String(erro) });
  }
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return responder_({ ok: false, erro: 'corpo vazio' });
    }
    var corpo;
    try {
      corpo = JSON.parse(e.postData.contents);
    } catch (erroParse) {
      return responder_({ ok: false, erro: 'corpo nao e JSON valido' });
    }
    if (!tokenValido_(corpo.token)) {
      return responder_({ ok: false, erro: 'token invalido' });
    }
    var texto = String(corpo.texto || '').trim();
    if (!texto) {
      return responder_({ ok: false, erro: 'texto vazio' });
    }

    var saidaIA;
    try {
      saidaIA = chamarIA_(texto);
    } catch (erroIA) {
      aba_('Registro').appendRow([agoraIso_(), texto, JSON.stringify({ erro: String(erroIA) })]);
      return responder_({ ok: false, erro: 'A IA nao conseguiu processar. Fale de novo, do seu jeito. Detalhe tecnico: ' + String(erroIA) });
    }

    var resumo = aplicarAcoes_(saidaIA.acoes || []);
    aba_('Registro').appendRow([agoraIso_(), texto, JSON.stringify(saidaIA)]);

    return responder_({
      ok: true,
      resposta: saidaIA.resposta || 'Anotado.',
      acoesAplicadas: resumo,
      estado: estado_()
    });
  } catch (erro) {
    return responder_({ ok: false, erro: String(erro) });
  }
}

// -------------------------------------------------------------------- IA ---

function chamarIA_(texto) {
  var chave = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!chave) throw new Error('ANTHROPIC_API_KEY nao configurada nas propriedades do script');

  var pedido = {
    model: MODELO_IA,
    max_tokens: 3000,
    system: promptSistema_(),
    messages: [{
      role: 'user',
      content: 'Estado atual:\n' + JSON.stringify(estadoCompacto_()) + '\n\nFrase da usuaria:\n' + texto
    }]
  };

  var resposta = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-api-key': chave, 'anthropic-version': '2023-06-01' },
    payload: JSON.stringify(pedido),
    muteHttpExceptions: true
  });

  var codigo = resposta.getResponseCode();
  var dados = JSON.parse(resposta.getContentText());
  if (codigo !== 200) {
    var detalhe = dados && dados.error && dados.error.message ? dados.error.message : ('HTTP ' + codigo);
    throw new Error('API Anthropic: ' + detalhe);
  }

  var textoIA = (dados.content || []).map(function (bloco) { return bloco.text || ''; }).join('');
  var cortada = dados.stop_reason === 'max_tokens';

  var inicio = textoIA.indexOf('{');
  var fim = textoIA.lastIndexOf('}');
  if (inicio === -1 || fim <= inicio) {
    throw new Error(cortada ? 'resposta da IA veio cortada' : 'a IA nao devolveu JSON');
  }
  try {
    return JSON.parse(textoIA.substring(inicio, fim + 1));
  } catch (erroParse) {
    throw new Error(cortada ? 'resposta da IA veio cortada no meio do JSON' : 'JSON da IA invalido');
  }
}

function promptSistema_() {
  return [
    'Voce e o motor de estruturacao do Frentes, um app pessoal de gestao de atencao.',
    'A usuaria fala uma frase solta; voce estrutura. Ela nunca preenche campos.',
    'Voce recebe o estado atual (frentes, passos, ideias) e a frase dela, e devolve APENAS um JSON puro, sem markdown, sem texto antes ou depois, neste formato:',
    '{"resposta": "frase curta e direta em portugues para a usuaria, sem travessoes",',
    ' "acoes": [',
    '  {"tipo": "criar_frente", "nome": "...", "rumo": "...", "onde_parei": "...", "passos": ["...", "..."]},',
    '  {"tipo": "concluir_passos", "frente_id": "...", "ordens": [1, 2]},',
    '  {"tipo": "atualizar_frente", "frente_id": "...", "onde_parei": "...", "rumo": "..."},',
    '  {"tipo": "mudar_status", "frente_id": "...", "status": "ativa|congelada|concluida"},',
    '  {"tipo": "guardar_ideia", "texto": "..."},',
    '  {"tipo": "julgar_ideia", "ideia_id": "...", "decisao": "virou_frente|esperando|morta", "nome": "...", "passos": ["..."]},',
    '  {"tipo": "priorizar", "frente_id": "...", "fundamento": "..."}',
    ' ]}',
    'Inclua em "acoes" somente o que a frase pede. Campos opcionais podem ser omitidos. A lista pode ser vazia se a frase nao pedir nada acionavel; nesse caso responda algo util em "resposta".',
    '',
    'Regras duras:',
    '1. Frente nova sempre nasce com 3 a 6 passos FISICOS, cada um executavel em ate 10 minutos, comecando com verbo no infinitivo (ex: "Abrir o documento X e ler a ultima secao"). Nada de passos vagos como "planejar" ou "organizar".',
    '2. Uma frente e um compromisso em andamento. Uma ideia e uma empolgacao nova sem compromisso: guarde como ideia, nao crie frente, a menos que a usuaria mande explicitamente criar.',
    '3. Ideia so pode ser julgada (julgar_ideia) se no estado ela aparecer com "julgavel": true. Antes disso, se a usuaria pedir, explique em "resposta" que a ideia ainda esta na quarentena de 72 horas.',
    '4. SIGILO, sem excecao: nunca escreva numero de processo, nome de fornecedor, valores em dinheiro ou qualquer identificador institucional. Se a frase contiver isso, substitua por descricao generica ("o processo da compra de equipamentos") e ponteiro ("dados no sistema oficial"). O dado oficial mora nos sistemas do orgao.',
    '5. Ja existem ' + LIMITE_FRENTES_ATIVAS + ' frentes ativas como limite saudavel. Pode criar alem disso se a usuaria mandar, mas avise do excesso em "resposta".',
    '6. Ao concluir passos ou registrar progresso, atualize tambem "onde_parei" da frente quando a frase permitir inferir, para amanha ela saber de onde retomar.',
    '7. Identifique frentes e ideias pelos ids exatos do estado. Nunca invente id.',
    '8. Se a frase mencionar retomada de trabalho em algo que ja existe, e atualizacao de frente, nao criacao de duplicata. So crie frente nova se nao houver correspondente no estado.',
    '9. "resposta" tem no maximo duas frases, tom direto e caloroso, sem travessoes, sem emoji.'
  ].join('\n');
}

function estadoCompacto_() {
  var estado = estado_();
  return {
    frentes: estado.frentes.map(function (f) {
      return {
        id: f.id, nome: f.nome, status: f.status, ondeParei: f.ondeParei,
        rumo: f.rumo, diasSemToque: f.diasSemToque,
        passos: f.passos.map(function (p) { return { ordem: p.ordem, descricao: p.descricao, feito: p.feito }; })
      };
    }),
    frenteDoDiaId: estado.frenteDoDia ? estado.frenteDoDia.id : null,
    ideias: estado.ideias.map(function (i) {
      return { id: i.id, texto: i.texto, status: i.status, julgavel: i.julgavel };
    })
  };
}

// ----------------------------------------------------------------- acoes ---

function aplicarAcoes_(acoes) {
  var resumo = [];
  acoes.forEach(function (acao) {
    try {
      switch (acao.tipo) {
        case 'criar_frente':
          resumo.push(criarFrente_(acao));
          break;
        case 'concluir_passos':
          resumo.push(concluirPassos_(acao));
          break;
        case 'atualizar_frente':
          resumo.push(atualizarFrente_(acao));
          break;
        case 'mudar_status':
          resumo.push(mudarStatus_(acao));
          break;
        case 'guardar_ideia':
          resumo.push(guardarIdeia_(acao));
          break;
        case 'julgar_ideia':
          resumo.push(julgarIdeia_(acao));
          break;
        case 'priorizar':
          resumo.push(priorizar_(acao));
          break;
        default:
          resumo.push('Acao desconhecida ignorada: ' + acao.tipo);
      }
    } catch (erro) {
      resumo.push('Falha na acao ' + acao.tipo + ': ' + String(erro));
    }
  });
  return resumo;
}

function criarFrente_(acao) {
  var id = Utilities.getUuid();
  var agora = agoraIso_();
  aba_('Frentes').appendRow([id, acao.nome || 'Frente sem nome', 'ativa', acao.onde_parei || '', acao.rumo || '', agora, agora, '']);
  var passos = acao.passos || [];
  var abaPassos = aba_('Passos');
  passos.forEach(function (descricao, indice) {
    abaPassos.appendRow([Utilities.getUuid(), id, indice + 1, descricao, '']);
  });
  return 'Frente criada: ' + (acao.nome || 'sem nome') + ' (' + passos.length + ' passos)';
}

function concluirPassos_(acao) {
  var agora = agoraIso_();
  var abaPassos = aba_('Passos');
  var valores = abaPassos.getDataRange().getValues();
  var concluidos = 0;
  var ordens = (acao.ordens || []).map(Number);
  for (var linha = 1; linha < valores.length; linha++) {
    if (valores[linha][1] === acao.frente_id && ordens.indexOf(Number(valores[linha][2])) !== -1 && !valores[linha][4]) {
      abaPassos.getRange(linha + 1, 5).setValue(agora);
      concluidos++;
    }
  }
  tocarFrente_(acao.frente_id);
  return concluidos + ' passo(s) concluido(s)';
}

function atualizarFrente_(acao) {
  var atualizacoes = {};
  if (acao.onde_parei !== undefined) atualizacoes.onde_parei = acao.onde_parei;
  if (acao.rumo !== undefined) atualizacoes.rumo = acao.rumo;
  atualizacoes.ultimo_toque = agoraIso_();
  if (!atualizarLinha_('Frentes', acao.frente_id, atualizacoes)) {
    return 'Frente nao encontrada: ' + acao.frente_id;
  }
  return 'Frente atualizada';
}

function mudarStatus_(acao) {
  var validos = ['ativa', 'congelada', 'concluida'];
  if (validos.indexOf(acao.status) === -1) {
    return 'Status invalido ignorado: ' + acao.status;
  }
  if (!atualizarLinha_('Frentes', acao.frente_id, { status: acao.status, ultimo_toque: agoraIso_() })) {
    return 'Frente nao encontrada: ' + acao.frente_id;
  }
  return 'Status da frente: ' + acao.status;
}

function guardarIdeia_(acao) {
  aba_('Ideias').appendRow([Utilities.getUuid(), acao.texto || '', agoraIso_(), 'quarentena']);
  return 'Ideia guardada (quarentena de ' + QUARENTENA_HORAS + 'h)';
}

function julgarIdeia_(acao) {
  var ideias = lerAba_('Ideias');
  var ideia = null;
  for (var i = 0; i < ideias.length; i++) {
    if (ideias[i].id === acao.ideia_id) { ideia = ideias[i]; break; }
  }
  if (!ideia) return 'Ideia nao encontrada: ' + acao.ideia_id;
  var capturada = paraData_(ideia.capturada_em);
  var horas = capturada ? (new Date() - capturada) / (60 * 60 * 1000) : 0;
  if (ideia.status !== 'quarentena' || horas < QUARENTENA_HORAS) {
    return 'Ideia ainda em quarentena, julgamento recusado';
  }
  var decisoes = { virou_frente: 'virou_frente', esperando: 'esperando', morta: 'morta' };
  if (!decisoes[acao.decisao]) return 'Decisao invalida: ' + acao.decisao;
  atualizarLinha_('Ideias', acao.ideia_id, { status: acao.decisao });
  if (acao.decisao === 'virou_frente') {
    return julgamento_(ideia, acao);
  }
  return 'Ideia julgada: ' + acao.decisao;
}

function julgamento_(ideia, acao) {
  var resultado = criarFrente_({
    nome: acao.nome || ideia.texto,
    rumo: acao.rumo || '',
    onde_parei: '',
    passos: acao.passos || []
  });
  return 'Ideia virou frente. ' + resultado;
}

function priorizar_(acao) {
  gravarConfig_('frente_do_dia_id', acao.frente_id || '');
  gravarConfig_('frente_do_dia_fundamento', acao.fundamento || '');
  gravarConfig_('frente_do_dia_definida_em', agoraIso_());
  if (acao.fundamento !== undefined && acao.frente_id) {
    atualizarLinha_('Frentes', acao.frente_id, { fundamento: acao.fundamento });
  }
  return 'Frente do dia definida';
}

function tocarFrente_(frenteId) {
  atualizarLinha_('Frentes', frenteId, { ultimo_toque: agoraIso_() });
}

/**
 * Atualiza colunas de uma linha achada pelo id (primeira coluna).
 * Devolve true se achou a linha.
 */
function atualizarLinha_(nomeAba, id, atualizacoes) {
  var aba = aba_(nomeAba);
  var valores = aba.getDataRange().getValues();
  var cabecalho = valores[0];
  for (var linha = 1; linha < valores.length; linha++) {
    if (valores[linha][0] === id) {
      Object.keys(atualizacoes).forEach(function (coluna) {
        var indice = cabecalho.indexOf(coluna);
        if (indice !== -1) {
          aba.getRange(linha + 1, indice + 1).setValue(atualizacoes[coluna]);
        }
      });
      return true;
    }
  }
  return false;
}

function gravarConfig_(chave, valor) {
  var aba = aba_('Config');
  var valores = aba.getDataRange().getValues();
  for (var linha = 1; linha < valores.length; linha++) {
    if (valores[linha][0] === chave) {
      aba.getRange(linha + 1, 2).setValue(valor);
      return;
    }
  }
  aba.appendRow([chave, valor]);
}

// ---------------------------------------------------------------- estado ---

function estado_() {
  var agora = new Date();
  var frentes = lerAba_('Frentes');
  var passos = lerAba_('Passos');
  var ideias = lerAba_('Ideias');
  var config = configComoMapa_();

  var passosPorFrente = {};
  passos.forEach(function (p) {
    var lista = passosPorFrente[p.frente_id] || (passosPorFrente[p.frente_id] = []);
    lista.push({
      id: p.id,
      ordem: Number(p.ordem) || 0,
      descricao: p.descricao,
      feito: Boolean(p.feito_em),
      feitoEm: isoOuVazio_(p.feito_em)
    });
  });
  Object.keys(passosPorFrente).forEach(function (chave) {
    passosPorFrente[chave].sort(function (a, b) { return a.ordem - b.ordem; });
  });

  var avisos = [];
  var ativas = 0;

  var frentesSaida = frentes.map(function (f) {
    var lista = passosPorFrente[f.id] || [];
    var feitos = lista.filter(function (p) { return p.feito; }).length;
    var referencia = paraData_(f.ultimo_toque) || paraData_(f.criada_em) || agora;
    var diasSemToque = Math.floor((agora - referencia) / (24 * 60 * 60 * 1000));
    if (f.status === 'ativa') {
      ativas++;
      if (diasSemToque > DIAS_PARA_SUGERIR_CONGELAMENTO) {
        avisos.push('A frente "' + f.nome + '" esta ha ' + diasSemToque + ' dias sem toque. Vale congelar?');
      }
    }
    return {
      id: f.id,
      nome: f.nome,
      status: f.status,
      ondeParei: f.onde_parei,
      rumo: f.rumo,
      fundamento: f.fundamento,
      ultimoToque: isoOuVazio_(f.ultimo_toque),
      diasSemToque: diasSemToque,
      percentual: lista.length ? Math.round((feitos / lista.length) * 100) : 0,
      passos: lista,
      proximoPasso: lista.filter(function (p) { return !p.feito; })[0] || null
    };
  });

  if (ativas > LIMITE_FRENTES_ATIVAS) {
    avisos.push('Voce tem ' + ativas + ' frentes ativas. O limite saudavel e ' + LIMITE_FRENTES_ATIVAS + '.');
  }

  var ideiasSaida = ideias.map(function (i) {
    var capturada = paraData_(i.capturada_em);
    var horas = capturada ? Math.floor((agora - capturada) / (60 * 60 * 1000)) : 0;
    return {
      id: i.id,
      texto: i.texto,
      capturadaEm: isoOuVazio_(i.capturada_em),
      status: i.status,
      horasDeQuarentena: horas,
      julgavel: i.status === 'quarentena' && horas >= QUARENTENA_HORAS
    };
  });

  var frenteDoDiaId = config.frente_do_dia_id || null;
  var frenteDoDia = null;
  if (frenteDoDiaId) {
    frenteDoDia = frentesSaida.filter(function (f) { return f.id === frenteDoDiaId; })[0] || null;
  }

  return {
    ok: true,
    versao: 2,
    geradoEm: agora.toISOString(),
    frentes: frentesSaida,
    frenteDoDia: frenteDoDia,
    fundamentoDoDia: config.frente_do_dia_fundamento || '',
    ideias: ideiasSaida,
    avisos: avisos
  };
}

// ------------------------------------------------------------- utilitarios ---

function tokenValido_(token) {
  var esperado = PropertiesService.getScriptProperties().getProperty('TOKEN_ACESSO');
  return Boolean(esperado) && token === esperado;
}

function responder_(objeto) {
  return ContentService
    .createTextOutput(JSON.stringify(objeto))
    .setMimeType(ContentService.MimeType.JSON);
}

function planilha_() {
  var props = PropertiesService.getScriptProperties();
  var candidatos = [props.getProperty('PLANILHA_ID'), PLANILHA_ID_PADRAO];
  var planilha = null;
  for (var i = 0; i < candidatos.length && !planilha; i++) {
    if (!candidatos[i]) continue;
    try {
      planilha = SpreadsheetApp.openById(candidatos[i]);
    } catch (erro) {
      planilha = null;
    }
  }
  if (!planilha) {
    planilha = SpreadsheetApp.create(NOME_PLANILHA);
  }
  props.setProperty('PLANILHA_ID', planilha.getId());
  Object.keys(CABECALHOS).forEach(function (nome) {
    var aba = planilha.getSheetByName(nome);
    if (!aba) {
      aba = planilha.insertSheet(nome);
      aba.appendRow(CABECALHOS[nome]);
      aba.setFrozenRows(1);
    }
  });
  var padrao = planilha.getSheetByName('Página1') || planilha.getSheetByName('Sheet1');
  if (padrao && planilha.getSheets().length > 1) {
    planilha.deleteSheet(padrao);
  }
  return planilha;
}

function aba_(nome) {
  return planilha_().getSheetByName(nome);
}

function lerAba_(nome) {
  var aba = aba_(nome);
  var valores = aba.getDataRange().getValues();
  if (valores.length < 2) return [];
  var cabecalho = valores[0];
  return valores.slice(1).filter(function (linha) {
    return linha.some(function (celula) { return celula !== '' && celula !== null; });
  }).map(function (linha) {
    var objeto = {};
    cabecalho.forEach(function (coluna, indice) {
      objeto[coluna] = linha[indice];
    });
    return objeto;
  });
}

function configComoMapa_() {
  var mapa = {};
  lerAba_('Config').forEach(function (linha) {
    mapa[linha.chave] = linha.valor;
  });
  return mapa;
}

function paraData_(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return valor;
  var data = new Date(valor);
  return isNaN(data.getTime()) ? null : data;
}

function isoOuVazio_(valor) {
  var data = paraData_(valor);
  return data ? data.toISOString() : '';
}

function agoraIso_() {
  return new Date().toISOString();
}
