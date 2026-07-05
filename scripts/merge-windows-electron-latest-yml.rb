#!/usr/bin/env ruby
# frozen_string_literal: true

# electron-updater on Windows reads `latest.yml` from the generic feed URL.
# When CI builds Windows x64 and arm64 in separate matrix jobs, each produces
# `dist/release/latest.yml` with the same basename. `gh release upload` uses
# the filename only, so the second upload overwrites the first — one CPU arch
# then gets the wrong manifest (wrong .exe / blockmap), downloads fail or never
# reach `update-downloaded`, and the UI looks like the update "vanished".
#
# This script merges all `release-assets/**/latest.yml` documents that share
# the same `version` into `release-assets/latest.yml`. It then removes the
# nested copies so GitHub Release upload only sees one Windows update manifest.
#
# Usage: ruby scripts/merge-windows-electron-latest-yml.rb release-assets

require 'yaml'

root = ARGV[0] || 'release-assets'
canonical_path = File.join(root, 'latest.yml')
pattern = File.join(root, '**', 'latest.yml')
paths = Dir.glob(pattern).sort
paths.reject! { |p| p.include?('node_modules') }
paths.reject! { |p| File.expand_path(p) == File.expand_path(canonical_path) }

exe_paths = Dir.glob(File.join(root, '**', 'xopc-*.exe')).reject { |p| p.include?('win-unpacked') }

if paths.length < 2
  if exe_paths.length > 1
    warn "merge-windows-electron-latest-yml: found #{exe_paths.length} Windows installers but only #{paths.length} latest.yml"
    exit 1
  end
  warn "merge-windows-electron-latest-yml: #{paths.length} latest.yml (skip merge)"
  exit 0
end

docs = paths.to_h { |p| [p, YAML.load_file(p)] }

unless docs.values.all? { |d| d.is_a?(Hash) && d['files'].is_a?(Array) }
  warn 'merge-windows-electron-latest-yml: unexpected YAML shape'
  exit 1
end

version = docs.values.first['version'].to_s
unless docs.values.all? { |d| d['version'].to_s == version }
  warn "merge-windows-electron-latest-yml: version mismatch across manifests (expected #{version})"
  exit 1
end

base = docs.values.first.dup
merged_files = []
seen_sha = {}

docs.each_value do |data|
  data['files'].each do |f|
    next unless f.is_a?(Hash)

    sha = f['sha512'].to_s
    next if sha.empty? || seen_sha[sha]

    seen_sha[sha] = true
    merged_files << f
  end
end

base['files'] = merged_files

yaml_out = YAML.dump(base)
File.write(canonical_path, yaml_out)

paths.each do |path|
  next if File.expand_path(path) == File.expand_path(canonical_path)

  File.delete(path)
end

warn "merge-windows-electron-latest-yml: merged #{merged_files.length} installer entr(y|ies) into #{canonical_path}"
