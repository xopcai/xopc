<script setup lang="ts">
import { useData, withBase } from 'vitepress'

const { lang } = useData()
const videoUrl = 'https://github.com/user-attachments/assets/b9f96383-dac3-4071-96ce-9696ccb1e559'
</script>

<template>
  <video
    class="launch-film"
    :src="videoUrl"
    :poster="withBase('/xopc-launch-film-poster.jpg')"
    :aria-label="lang === 'zh' ? 'XOPC 产品宣传片' : 'XOPC launch film'"
    controls
    playsinline
    preload="none"
  ></video>
</template>

<style scoped>
.launch-film {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
}
</style>
