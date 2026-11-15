<template>
    <aside class="formation-navigator" aria-label="Formation products">
        <header>
            <div class="heading">
                <strong>Formation products</strong>
                <button
                    class="close-sidebar"
                    type="button"
                    aria-label="Close formation products"
                    title="Close formation products"
                    @click="$emit('close')">
                    ×
                </button>
            </div>
            <span :title="name">{{ name }}</span>
        </header>
        <ol ref="slides" aria-label="Processing slides">
            <li v-for="(product, index) in products" :key="product.id">
                <button
                    type="button"
                    :aria-label="`${index + 1}. ${product.title}`"
                    :aria-current="selected === product.id ? 'step' : undefined"
                    @click="$emit('select', product.id)"
                    @keydown="navigate($event, index)">
                    <span class="slide-number">{{ index + 1 }}</span>
                    <img :src="product.previewDataUrl" alt="" loading="lazy" />
                    <span class="slide-title">{{ product.title }}</span>
                </button>
            </li>
        </ol>
    </aside>
</template>
<script setup lang="ts">
import { nextTick, ref } from "vue";
import type { FormationProduct } from "@/types/formation";
const props = defineProps<{
    products: FormationProduct[];
    selected: string;
    name: string;
}>();
const emit = defineEmits<{ select: [id: string]; close: [] }>();
const slides = ref<HTMLOListElement>();
async function navigate(event: KeyboardEvent, index: number) {
    const offsets: Record<string, number> = {
        ArrowDown: 1,
        ArrowRight: 1,
        ArrowUp: -1,
        ArrowLeft: -1
    };
    if (
        !(event.key in offsets) &&
        event.key !== "Home" &&
        event.key !== "End"
    ) {
        return;
    }
    event.preventDefault();
    const target =
        event.key === "Home"
            ? 0
            : event.key === "End"
              ? props.products.length - 1
              : Math.max(
                    0,
                    Math.min(
                        props.products.length - 1,
                        index + offsets[event.key]!
                    )
                );
    emit("select", props.products[target]!.id);
    await nextTick();
    slides.value?.querySelectorAll("button")[target]?.focus();
}
</script>
<style scoped>
.formation-navigator {
    flex: 0 0 clamp(125px, 18vw, 190px);
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: #f6f8fa;
    border-right: 1px solid #ccd4de;
    color: #243447;
}
header {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 10px;
    font-size: 12px;
}
.heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
}
button.close-sidebar {
    width: 24px;
    height: 24px;
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    font-size: 20px;
    line-height: 1;
    background: transparent;
}
header span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #64748b;
}
ol {
    list-style: none;
    padding: 0 8px 12px;
    margin: 0;
    overflow-y: auto;
}
li {
    margin-bottom: 8px;
}
button {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 100%;
    padding: 6px;
    border: 2px solid transparent;
    border-radius: 4px;
    background: white;
    color: inherit;
    text-align: left;
    cursor: pointer;
    font: inherit;
}
button:hover {
    background: #e9eef4;
}
button[aria-current="step"] {
    border-color: #1976d2;
    background: #eaf3fc;
}
button:focus-visible {
    outline: 2px solid #1976d2;
    outline-offset: 1px;
}
img {
    width: 100%;
    height: 80px;
    object-fit: contain;
    background: #111b27;
}
.slide-number {
    font-size: 10px;
    color: #64748b;
}
.slide-title {
    font-size: 11px;
    line-height: 1.4;
}
</style>
