/**
 * Frentes: backend (etapa 1)
 *
 * Web App do Google Apps Script. Os dados moram em uma planilha criada
 * automaticamente no seu Drive na primeira execucao. Nenhum conteudo
 * institucional e guardado aqui: so estado e ponteiros.
 *
 * Propriedades do script (Configuracoes do projeto > Propriedades do script):
 *   TOKEN_ACESSO       token secreto que o app envia em cada chamada
 *   ANTHROPIC_API_KEY  chave da API Anthropic (sera usada a partir da etapa 2)
 *
 * Nesta etapa o doPost ainda nao chama a IA: ele registra a frase recebida
 * na aba Registro e devolve um eco, provando o caminho iPhone -> backend ->
 * planilha. A IA entra na etapa 2.
 */

var NOME_PLANILHA = 'Frentes (dados)';

// Planilha ja criada no Drive da Elaine em 13/07/2026. O script adota esta;
// se ela for apagada um dia, o script cria outra sozinho e segue a vida.
var PLANILHA_ID_PADRAO = '1BzMVkn78Ey9VxNui1VoZz2ZgmiayxIPUnv7A6GQrSz4';

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
 * acessos e criar a planilha. O endereco da planilha sai no log.
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
    Logger.log('A propriedade ANTHROPIC_API_KEY ainda nao existe. Sem problema na etapa 1; sera exigida na etapa 2.');
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

    // Etapa 1: so registra e ecoa. A estruturacao pela IA entra na etapa 2.
    aba_('Registro').appendRow([agoraIso_(), texto, JSON.stringify({ etapa: 1, acoes: [] })]);

    return responder_({
      ok: true,
      recebido: texto,
      aviso: 'Etapa 1: frase registrada na planilha. A IA ainda nao estrutura nada.',
      estado: estado_()
    });
  } catch (erro) {
    return responder_({ ok: false, erro: String(erro) });
  }
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
    versao: 1,
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
