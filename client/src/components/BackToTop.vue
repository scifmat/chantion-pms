<template>
  <transition name="rocket">
    <button
      v-if="visible"
      type="button"
      class="back-to-top"
      aria-label="回到顶部"
      title="回到顶部"
      @click="toTop"
    >
      <svg
        class="rocket-icon"
        :class="{ launching: launching }"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
        <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
        <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
        <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
      </svg>
      <span class="rocket-flame" :class="{ on: launching }" aria-hidden="true"></span>
    </button>
  </transition>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

// 右侧工作区 #content 是系统唯一滚动容器；侧边栏不滚动，所以按钮位置固定即可。
const THRESHOLD = 320
const visible = ref(false)
const launching = ref(false)
let scroller = null
let timer = null

function onScroll() {
  visible.value = !!scroller && scroller.scrollTop > THRESHOLD
}

function toTop() {
  if (!scroller) return
  launching.value = true
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  scroller.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' })
  clearTimeout(timer)
  timer = setTimeout(function () { launching.value = false }, 700)
}

onMounted(function () {
  scroller = document.getElementById('content')
  if (scroller) scroller.addEventListener('scroll', onScroll, { passive: true })
  onScroll()
})

onBeforeUnmount(function () {
  if (scroller) scroller.removeEventListener('scroll', onScroll)
  clearTimeout(timer)
})
</script>

<style scoped>
.back-to-top{
  position:fixed;right:26px;bottom:26px;z-index:40;
  width:46px;height:46px;padding:0;border:1px solid rgba(255,255,255,.45);border-radius:50%;
  background:linear-gradient(145deg,#4b86f7,#2f6fed);color:#fff;
  display:flex;align-items:center;justify-content:center;cursor:pointer;
  box-shadow:0 6px 18px rgba(47,111,237,.32);
  transition:transform .2s ease,box-shadow .2s ease;
}
.back-to-top:hover{transform:translateY(-3px);box-shadow:0 11px 24px rgba(47,111,237,.42)}
.back-to-top:active{transform:translateY(0) scale(.96)}
.back-to-top:focus-visible{outline:2px solid #fff;outline-offset:2px}
.rocket-icon{width:22px;height:22px;position:relative;z-index:1;transition:transform .25s ease}
.back-to-top:hover .rocket-icon{transform:translateY(-2px) rotate(-8deg)}
.rocket-icon.launching{animation:rocket-launch .65s cubic-bezier(.34,1.56,.64,1)}
.rocket-flame{
  position:absolute;bottom:6px;left:50%;width:9px;height:13px;margin-left:-4.5px;
  background:linear-gradient(180deg,#ffd66e,#ff7a35);
  clip-path:polygon(50% 100%,0 38%,28% 46%,50% 0,72% 46%,100% 38%);
  opacity:0;transition:opacity .2s ease;
}
.back-to-top:hover .rocket-flame,.rocket-flame.on{opacity:.95}
.rocket-flame.on{animation:flame-flicker .16s infinite alternate}
@keyframes rocket-launch{
  0%{transform:translateY(0) rotate(0)}
  45%{transform:translateY(-10px) rotate(-12deg) scale(1.08)}
  100%{transform:translateY(0) rotate(0)}
}
@keyframes flame-flicker{from{transform:scaleY(.82)}to{transform:scaleY(1.15)}}
.rocket-enter-active,.rocket-leave-active{transition:opacity .25s ease,transform .25s ease}
.rocket-enter-from,.rocket-leave-to{opacity:0;transform:translateY(14px) scale(.88)}
@media (prefers-reduced-motion: reduce){
  .back-to-top,.rocket-icon,.rocket-flame,.rocket-enter-active,.rocket-leave-active{transition:none;animation:none}
}
</style>
