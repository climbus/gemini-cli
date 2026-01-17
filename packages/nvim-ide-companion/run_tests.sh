#!/bin/bash
nvim --headless --noplugin -u tests/minimal_init.lua -c "lua require('plenary.test_harness').test_directory('tests/', { minimal_init = 'tests/minimal_init.lua' })"
