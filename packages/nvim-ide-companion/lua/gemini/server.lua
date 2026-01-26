-- Server lifecycle management

local M = {}

M.job_id = nil
M.server_port = nil

function M.start(config)
  if M.job_id then
    print('Gemini server already running')
    return
  end

  -- Start Neovim RPC server
  local socket = vim.fn.serverstart()

  -- Find Node.js server script
  local server_path = vim.fn.stdpath('data') .. '/gemini-nvim/dist/index.js'

  -- Check if server exists
  if vim.fn.filereadable(server_path) == 0 then
    vim.notify('Gemini server not found. Run npm install in the plugin directory.', vim.log.levels.ERROR)
    return
  end

  -- Get Neovim PID
  local nvim_pid = vim.fn.getpid()
  local workspace = vim.fn.getcwd()

  -- Start Node.js server
  M.job_id = vim.fn.jobstart({'node', server_path}, {
    env = {
      NVIM_SOCKET = socket,
      NVIM_PID = tostring(nvim_pid),
      NVIM_WORKSPACE = workspace,
      GEMINI_DEBUG = config.debug and 'true' or 'false',
    },
    on_stdout = function(_, data)
      if config.debug then
        for _, line in ipairs(data) do
          if line ~= '' then
            print('[Gemini] ' .. line)
          end
        end
      end
    end,
    on_stderr = function(_, data)
      for _, line in ipairs(data) do
        if line ~= '' then
          vim.notify('[Gemini Error] ' .. line, vim.log.levels.ERROR)
        end
      end
    end,
    on_exit = function(_, code)
      M.job_id = nil
      M.server_port = nil
      if code ~= 0 then
        vim.notify('Gemini server exited with code: ' .. code, vim.log.levels.WARN)
      end
    end,
  })

  print('Gemini IDE Companion started')
end

function M.stop()
  if M.job_id then
    vim.fn.jobstop(M.job_id)
    M.job_id = nil
    M.server_port = nil
    print('Gemini IDE Companion stopped')
  else
    print('Gemini server not running')
  end
end

function M.status()
  if M.job_id then
    print('Gemini server: Running (job_id: ' .. M.job_id .. ')')
    if M.server_port then
      print('Server port: ' .. M.server_port)
    end
  else
    print('Gemini server: Not running')
  end
end

function M.get_channel_id()
  return M.job_id
end

return M
