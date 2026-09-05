Pod::Spec.new do |s|
  s.name = 'XopcVoice'
  s.version = '1.0.0'
  s.summary = 'XOPC native duplex audio'
  s.description = 'Bounded PCM capture and playback for XOPC voice calls.'
  s.license = { :type => 'MIT' }
  s.author = 'XOPC'
  s.homepage = 'https://github.com/xopcai/xopc'
  s.platforms = { :ios => '16.4' }
  s.swift_version = '5.9'
  s.source = { :git => 'https://github.com/xopcai/xopc' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
