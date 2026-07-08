-- Função para zerar o progresso de um usuário
-- (respostas + respostas_avaliacao + progresso_usuario).
-- Rode este arquivo UMA VEZ no SQL Editor do Supabase.
-- (atualizada em jul/2026: grava progresso_resetado_em em users para o app
--  limpar o cache local do usuário em vez de devolvê-lo pro banco — rodar de novo)
-- SECURITY DEFINER: roda com privilégios do dono, contornando o RLS,
-- mas só executa se quem chama for admin ou super admin.

ALTER TABLE users ADD COLUMN IF NOT EXISTS progresso_resetado_em timestamptz;

CREATE OR REPLACE FUNCTION reset_progresso_usuario(alvo uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n_respostas int;
  n_resp_av   int;
  n_progresso int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users
    WHERE id = auth.uid() AND access_level IN ('adm', 'super')
  ) THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores podem zerar progresso.';
  END IF;

  DELETE FROM respostas WHERE user_id = alvo;
  GET DIAGNOSTICS n_respostas = ROW_COUNT;

  DELETE FROM respostas_avaliacao WHERE user_id = alvo;
  GET DIAGNOSTICS n_resp_av = ROW_COUNT;

  DELETE FROM progresso_usuario WHERE user_id = alvo;
  GET DIAGNOSTICS n_progresso = ROW_COUNT;

  -- Marca o momento do reset: o app compara com o cache local e,
  -- se o reset for mais novo, apaga as marcações do navegador do usuário
  UPDATE users SET progresso_resetado_em = now() WHERE id = alvo;

  RETURN json_build_object('respostas', n_respostas, 'respostas_avaliacao', n_resp_av, 'progresso', n_progresso);
END;
$$;

REVOKE EXECUTE ON FUNCTION reset_progresso_usuario(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION reset_progresso_usuario(uuid) TO authenticated;
