import { FeedController } from "./feed_controller";
import { TweetVisualization } from "./tweet_visualization";
import { TweetNode, TweetTree } from "./tweet_tree";
import { TweetServer } from "./tweet_server";
import { Toolbar } from "./toolbar";
import { SerializedTweetNode } from "./serialize";
import * as d3 from "d3";
import { ContentProxy } from "./proxy";
import { compact } from "lodash";

export type PointNode = d3.HierarchyPointNode<TweetNode>;

const formatTweet = (tweet, other) => {
  let md = tweet.bodyText;
  if (tweet.entities.user_mentions) {
    if (
      tweet.entities.user_mentions.some(
        user => user.screen_name === "threadreaderapp"
      )
    ) {
      return false;
    }
    // tweet.entities.user_mentions.forEach(user => {
    //   md = md.split("@" + user.screen_name).join("");
    // });
  }
  if (tweet.entities.urls) {
    tweet.entities.urls.forEach(url => {
      md = md.split(url.url).join(url.expanded_url);
    });
  }
  md = md.trim();
  if (md === "") {
    return undefined;
  }
  return `${other ? `[[${tweet.name}]]: ` : ""}${md
    .replace(/^(\@.+?\s)+/g, "")
    .replace(/^[\•\-\*]/gm, "")
    .trim()}`;
};
const formatTweets = (
  node,
  initial = false,
  indent = 1,
  initialAuthor = "",
  hasSiblings = false
) => {
  let out = "";
  if (node.tweet.username === "threadreaderapp") {
    return false;
  }

  const tweetTextRaw = formatTweet(
    node.tweet,
    initialAuthor === "" || node.tweet.username !== initialAuthor
  );
  const tweetText = tweetTextRaw
    ? tweetTextRaw
        .split(/\n+/)
        .map(f => f.trim())
        .join("\n" + "  ".repeat(indent + 1) + "- ")
    : false;

  if (initial) {
    out = `- #[[Twitter thread]] ${tweetText} [*](${node.tweet.getUrl()})\n`;
    initialAuthor = node.tweet.username;
  } else {
    if (tweetText) {
      out =
        "  ".repeat(indent) +
        "- " +
        tweetText +
        " [*](" +
        node.tweet.getUrl() +
        ")\n";
    }
    if (node.tweet.entities.media) {
      node.tweet.entities.media.forEach(m => {
        out +=
          "  ".repeat(indent + 1) + "- " + "![](" + m.media_url_https + ")\n";
      });
    }
  }
  if (node.children) {
    const children = Array.from(node.children).filter(
      x => x[1].tweet.username !== "threadreaderapp"
    );
    const multiChildren = children.length > 1;
    const newIndent = multiChildren || hasSiblings ? indent + 1 : indent;
    out += children
      .map(([k, v]) =>
        formatTweets(v, false, newIndent, initialAuthor, multiChildren)
      )
      .join("\n");
  }
  return out;
};

const expandText = "Expand All";
const cancelExpandText = "Stop Expanding";

/**
 * The controller for the main tree visualization.
 */
export class VisualizationController {
  private tweetTree: TweetTree;
  private vis: TweetVisualization;
  private feed: FeedController;
  private toolbar: Toolbar;
  private server: TweetServer;
  private expandingTimer: number;
  private expandButton: HTMLButtonElement;

  fetchTweets(tweetId: string) {
    this.server.requestTweets(tweetId, null).then(tweetSet => {
      let tweetTree = TweetTree.fromTweetSet(tweetSet);
      document.getElementsByTagName("title")[0].innerText = `${
        tweetTree.root.tweet.username
      } - "${tweetTree.root.tweet.bodyText}" in Treeverse`;

      this.setInitialTweetData(tweetTree);
    });
  }

  setInitialTweetData(tree: TweetTree) {
    this.tweetTree = tree;
    this.vis.setTreeData(tree);
    this.vis.zoomToFit();
  }

  private expandNode(node: TweetNode, retry: boolean = true) {
    this.server.requestTweets(node.tweet.id, node.cursor).then(tweetSet => {
      let added = this.tweetTree.addTweets(tweetSet);
      if (added > 0) {
        this.vis.setTreeData(this.tweetTree);
        if (node === this.tweetTree.root) {
          this.vis.zoomToFit();
        }
      } else if (retry) {
        this.expandNode(node, false);
      }
    });
  }

  shareClicked() {
    let value = SerializedTweetNode.fromTweetNode(this.tweetTree.root);
    chrome.runtime.sendMessage({ payload: value, message: "share" });
  }

  expandOne() {
    for (let tweetNode of this.tweetTree.index.values()) {
      if (tweetNode.hasMore()) {
        this.expandNode(tweetNode, true);
        return;
      }
    }
    this.stopExpanding();
  }

  stopExpanding() {
    this.expandButton.textContent = expandText;
    clearInterval(this.expandingTimer);
    this.expandingTimer = null;
  }

  copyClipboard() {
    navigator.clipboard.writeText(
      formatTweets(this.tweetTree.root, true) || ""
    );
  }

  expandAll() {
    if (this.expandingTimer === null) {
      this.expandButton.textContent = cancelExpandText;
      this.expandingTimer = setInterval(this.expandOne.bind(this), 1000);
    } else {
      this.stopExpanding();
    }
  }

  constructor(proxy: ContentProxy = null) {
    const offline = proxy === null;
    this.server = offline ? null : new TweetServer(proxy);
    this.feed = new FeedController(document.getElementById("feedContainer"));
    this.vis = new TweetVisualization(document.getElementById("tree"));
    this.expandingTimer = null;

    this.toolbar = new Toolbar(document.getElementById("toolbar"));
    if (!offline) {
      this.toolbar.addButton(
        "Create shareable link",
        this.shareClicked.bind(this)
      );
      this.toolbar.addButton(
        "Copy to clipboard",
        this.copyClipboard.bind(this)
      );
      this.expandButton = this.toolbar.addButton(
        "Expand All",
        this.expandAll.bind(this)
      );
    }

    this.vis.on("hover", this.feed.setFeed.bind(this.feed));
    if (!offline) {
      this.vis.on("dblclick", this.expandNode.bind(this));
    }
  }
}
